---
title: "Parallel Processing in JsonSchema.Net"
date: 2023-07-03 09:00:00 +1200
tags: [json-schema, async]
toc: true
pin: false
---

This post wraps up (for now) the adventure of updating *JsonSchema.Net* to run in an async context by exploring parallel processing.  First, let's cover the concepts in JSON Schema that allow parallel processing.  Then, we'll look at what that means for *JsonSchema.Net* as well as my experience trying to make it work.

Part of the reason I'm writing this is sharing my experience.  I'm also writing this to have something to point at when someone asks why I don't take advantage of a multi-threaded approach.

## Parallelization in JSON Schema

There are two aspects of evaluating a schema that can be parallelized.

The first is by subschema (within the context of a single keyword).  For those keywords which contain multiple subschemas, e.g. `anyOf`, `properties`, etc, their subschemas are independent from each other, and so evaluating them simultaneously won't affect the others' outcomes.  These keywords then aggregate the results from their subschemas in some way:

- `anyOf` ensures that at least one of the subschemas passed (logical OR).  This can be short-circuited to a passing validation when any subschema passes.
- `allOf` ensures that all of the subschemas passed (logical AND).  This can be short-circuited to a failing validation when any subschema fails.
- `properties` and `patternProperties` map subschemas to object-instance values by key and ensures that those values match the associated subschemas (logical AND, but only for those keys which match).  These can also be short-circuited to a failing validation when any subschema fails.

The other way schema evaluation can be parallelized is by keyword within a (sub)schema.

A schema is built using a collection of keywords, each of which define a constraint.  Those constraints are usually independent (e.g. `type`, `minimum`, `properties`, etc.), however some keywords have dependencies on other keywords (e.g. `additionalProperties`, `contains`, `else`, etc.).

Organizing the keywords into dependency groups, and then sorting those groups so that each group's dependencies are run before the group, we find that the keywords in each group can be run in parallel.

### 1. Keywords with no dependencies

We start with keywords which have no dependencies.

- `type`
- `minimum`/`maximum`
- `allOf`/`anyOf`/`not`
- `properties`
- `patternProperties`
- `if`
- `minContains`/`maxContains`

None of these keywords (among others) have any impact on the evaluation of the others within this group.  Running them in parallel is fine.

Interestingly, though, some of these, like `properties`, `patternProperties`, and `if`, are themselves dependencies of keywords not in this set.

### 2. Keywords with only dependencies on independent keywords

Once we have all of the independent keywords processed, we can evaluate the next set of keywords:  ones that only depend on the first set.

- `additionalProperties` (depends on `properties` and `patternProperties`)
- `then`/`else` (depends on `if`)
- `contains` (depends on `minContains`/`maxContains`)

> Technically, if we don't mind processing some keywords multiple times, we can run all of the keywords in parallel.  For example, we can process `then` and `else` in the first set if we process `if` for each of them.  *JsonSchema.Net* seeks to process each keyword once, so it performs this dependency grouping.
{: .prompt-info}

This then repeats, processing only those keywords which have dependencies that have already been processed.

In each iteration, all of the keywords in that iteration can be processed in parallel because their dependencies have completed.

The last keywords to run are `unevaluatedItems` and `unevaluatedProperties`.  These keywords are special in that they consider the results of subschemas in _any_ adjacent keywords, such as `allOf`.  That means any keyword, including keywords defined in third-party vocabularies, are dependencies of these two.  Running them last ensures that all dependencies are met.

## Parallelization in *JsonSchema.Net*

For those who wish to see what this ended up looking like, the issue where I tracking this process is [here](https://github.com/gregsdennis/json-everything/issues/480) and the final result of the branch is [here](https://github.com/gregsdennis/json-everything/tree/schema/async).  (Maybe someone looking at the changes can find somewhere I went wrong.  Additional eyes are always welcome.)

Once I moved everything over to [async function calls](/posts/json-schema-async), I started on the parallelization journey by updating `AllOfKeyword` for subschema parallelization.  In doing this, I ran into my first conundrum.

### The evaluation context

Quite a long time ago, in response to a report of high allocations, I updated the evaluation process so that it re-used the evaluation context.  Before this change, each subschema evaluation (and each keyword evaluation) would create a new context object based on information in the "current" context, and then the results from that evaluation would be copied back into the "current" context as necessary.  The update changed this processes so that there was a single context that maintained a series of stacks to track where it was in the evaluation process.

A consequence of this change, however, was that I could only process serially because the context indicated one specific evaluation path at a time.  The only way to move into a parallel process (in which I needed to track multiple evaluation paths simultaneously) was to revert at least some of that allocation management, which meant more memory usage again.

I think I figured out a good way to do it without causing too many additional allocations by only creating a new context when multiple branches were possible.  So that means any keywords that have one a single subschema would continue to use the single context, but any place where the process could branch would create new contexts that only held the top layer of the stacks from the parent context.

I updated all of the keywords to use this branching strategy, and it passed the test suite, but for some reason it ran slower.

**Sync**

|   Method | optimized |     Mean |    Error |   StdDev |       Gen0 |       Gen1 |      Gen2 | Allocated |
|--------- |---------- |---------:|---------:|---------:|-----------:|-----------:|----------:|----------:|
| RunSuite |     False | 874.0 ms | 13.53 ms | 12.65 ms | 80000.0000 | 19000.0000 | 6000.0000 | 178.93 MB |
| RunSuite |      True | 837.3 ms | 15.76 ms | 14.74 ms | 70000.0000 | 22000.0000 | 8000.0000 | 161.82 MB |

**Async**

|   Method | optimized |    Mean |    Error |   StdDev |       Gen0 |       Gen1 |      Gen2 | Allocated |
|--------- |---------- |--------:|---------:|---------:|-----------:|-----------:|----------:|----------:|
| RunSuite |     False | 1.080 s | 0.0210 s | 0.0206 s | 99000.0000 | 29000.0000 | 9000.0000 | 240.26 MB |
| RunSuite |      True | 1.050 s | 0.0204 s | 0.0201 s | 96000.0000 | 29000.0000 | 9000.0000 | 246.53 MB |

Investigating this led to some interesting discoveries.

### Async is not always parallel

My first thought was to check whether evaluation was utilizing all of the processor's cores.  So I started up my Task Manager and re-ran the benchmark.

![](https://user-images.githubusercontent.com/2676804/248963378-3ff6b6c7-2ade-4423-81ae-9fd9dac72fd0.png)
_Performance tab of the Task Manager during a benchmark run._

One core is pegged out completely, and the others are unaffected.  That's not parallel.

A little research later, and it seems that unless you explicitly call `Task.Run()`, a task will be run on the same thread that spawned it.  `Task.Run()` tells .Net to run the code on a new thread.  So I updated all of the keywords again to create new threads.

### Things get weird

Before I ran the benchmark again, I wanted to run the test suite to make sure that the changes I made still actually evaluated schemas properly.  After all, what good is running really fast if you're going the wrong direction?

Of the 7,898 tests that I run from the official JSON Schema Test Suite, about 15 failed.  That's not bad, and it usually means that I have some data mixed up somewhere, a copy/paste error, or something like that.

Running each test on its own, though, they all passed.

Running the whole suite again, and 17 would fail.

Running all of the failed tests together, and they would all pass.

Running the the suite again... 12 failed.

Each time I ran the full, it was a different group of less than 20 tests that would fail.  And every time, they'd pass if I ran them in isolation or in a smaller group.  This was definitely a parallelization problem.  I added some debug logging to see what the context was holding.

Eventually, I found that for the failed tests, the instance would inexplicably delete all of its data.  Here's some of that logging:

```
starting  /properties - instance root: {"foo":[1,2,3,4]} (31859421)
starting  /patternProperties - instance root: {"foo":[1,2,3,4]} (31859421)
returning /patternProperties - instance root: {} (31859421)
returning /properties - instance root: {} (31859421)
starting  /additionalProperties - instance root: {} (31859421)
returning /additionalProperties - instance root: {} (31859421)
```

The "starting" line was printed immediately before calling into a keyword's `.Evaluate()` method, and the "returning" line was called immediately afterward.  The parenthetical numbers afterward are the hash code (i.e. `.GetHashCode()`) of the `JsonNode` object, so you can see that it's the same object, only the contents are missing.

None of my code edits the instance: all access is read only.  So I have no idea how this is happening.

> A few days ago, just by happenstance, [this _dotnet/runtime_ PR](https://github.com/dotnet/runtime/pull/88194) was merged, which finished off changes in [this PR](https://github.com/dotnet/runtime/pull/77567) from last year, which resolved multi-threading issues in `JsonNode`... _**that [I reported](https://github.com/dotnet/runtime/issues/77421)!**_  I'm not sure how that slipped by me while working on this.  This fix is slated to be included in .Net 8.
{: .prompt-info}

I finally figure out that if I access the instance before (or immediately after) entering each thread, then it seems to work, so I set about making edits to do that.  If the instance is a `JsonObject` or `JsonArray`, I simply access the `.Count` property.  This is the simplest and quickest thing I could think to do.

That got all of the tests working.

### Back to our regularly scheduled program

With the entire test suite now passing every time I ran it, I wanted to see how we were doing on speed.

I once again set up the benchmark and ran it with the Task Manager open.

![](https://user-images.githubusercontent.com/2676804/249985318-84d8d45c-9d3d-483d-bc1f-2f4cb075f341.png)
_Performance tab of the Task Manager during a benchmark run with proper multi-threading._

The good news is that we're actually multi-threading now.  The bad news is that the benchmark is reporting that the test takes _twice_ as long as synchronous processing and uses a lot more memory.

|   Method | optimized |    Mean |    Error |   StdDev |        Gen0 |       Gen1 | Allocated |
|--------- |---------- |--------:|---------:|---------:|------------:|-----------:|----------:|
| RunSuite |     False | 1.581 s | 0.0128 s | 0.0120 s | 130000.0000 | 39000.0000 |  299.3 MB |
| RunSuite |      True | 1.681 s | 0.0152 s | 0.0135 s | 134000.0000 | 37000.0000 | 309.65 MB |

I don't know how this could be.  Maybe touching the instance causes a re-initialization that's more expensive than I expect.  Maybe spawning and managing all of those threads takes more time than the time saved by running the evaluations in parallel.  Maybe I'm just doing it wrong.

The really shocking result is that it's actually _slower_ when "optimized."  That is, taking advantage of short-circuiting when possible by checking for the first task that completed with a result that matched a predicate, and then cancelling the others.  (My code for this was basically re-inventing [this SO answer](https://stackoverflow.com/a/38289587/878701).)

Given this result, I just can't see this library moving into parallelism anytime soon.  Maybe once .Net Framework is out of support, and I move it into the newer .Net era (which contains the threading fix) and out of .Net Standard (which won't ever contain the fix), I can revisit this.
