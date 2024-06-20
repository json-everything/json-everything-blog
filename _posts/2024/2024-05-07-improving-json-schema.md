---
title: "Improving JsonSchema.Net (Part 1)"
date: 2024-05-07 09:00:00 +1200
tags: [json-schema, architecture, performance, learning]
toc: true
pin: false
---

In the last two posts, I talked about the [improvements to _JsonPointer.Net_](/posts/better-json-pointer/) and some of the [memory management tools](/posts/lesson-in-memory-mgmt/) I used to enact those improvements.

In this post, I'd like to start talking about some of the changes I made to _JsonSchema.Net_ for v7.0.0.  Rather than just showing the final result, I'll be taking you through the journey of changing the code because I think it's important to share the iterative development process.  Designs don't just come to us complete.  We have an idea first, and through trying to implement that idea, we find and work around caveats and gotchas that eventually lead us to the final solution.

## Results first

The benchmark runs through the JSON Schema Test Suite _n_ times.

| Version  | n  | Mean     | Error    | StdDev   | Gen0        | Gen1      | Allocated |
|----------|--- |---------:|---------:|---------:|------------:|----------:|----------:|
| v6.1.2   | 1  |   412.7 ms | 14.16 ms | 41.30 ms |  27000.0000 |  1000.0000 |  82.66 MB |
| v7.0.0   | 1  | 296.5 ms |  5.82 ms | 10.03 ms |  21000.0000 | 4000.0000 |  72.81 MB |
| v6.1.2   | 10 | 1,074.7 ms | 22.24 ms | 63.82 ms | 218000.0000 | 11000.0000 | 476.56 MB |
| v7.0.0   | 10 | 903.0 ms | 17.96 ms | 40.91 ms | 202000.0000 | 9000.0000 | 443.65 MB |

The improvement isn't as impressive as with _JsonPointer.Net_, but I'm still quite happy with it.

Interestingly, the _JsonPointer.Net_ improvements didn't contribute as much to the overall memory usage as I thought they would.  I'd say maybe half of the improvement here is just follow-on effect from _JsonPointer.Net_.  The rest is some necessary refactoring and applying the same memory management tricks from the previous post.

## Target: memory management inside `JsonSchema`

My first process for making improvements was running the test suite with Resharper's profiler and looking at allocations.  There were two areas that were causing the most pain:

- `JsonSchema.PopulateConstraint()`
- `JsonSchema.GetSubschemas()` & `.IsDynamic()`

## `PopulateConstraint()`

The primary source for allocations was from this `JsonSchema`-private method, which is responsible for actually building out the schema constraint for the `JsonSchema` instance, including all of the constraints for the keywords and their subschemas.  This is the hub for all of the [static analysis](/posts/new-json-schema-net/).

In this method, I was allocating several `List<T>`s and arrays that were only used within the scope of the method and then released.  I also relied heavily on LINQ methods to create multiple collections to help me manage which keywords need to be evaluated (based on the schema version and dialect being used).  Then I'd run through two loops, one for the keywords to process and one to collect the rest as annotations.

To remove these allocations, I used the `MemoryPool<T>` strategy from the last post.  I've also combined the two loops.  Instead of pre-calculating the lists, I determine which keywords to process individually as I iterate over all of them.  There is still a little LINQ to perform some sorting, but I'd rather leave that kind of logic to the framework.

What was arguably more concise:

```csharp
// Organize the keywords into different categories - a collection per category.
// Lots of allocation going on here.
var localConstraints = new List<KeywordConstraint>();
var version = DeclaredVersion == SpecVersion.Unspecified ? context.EvaluatingAs : DeclaredVersion;
var keywords = EvaluationOptions.FilterKeywords(context.GetKeywordsToProcess(this, context.Options), version).ToArray();
var unrecognized = Keywords!.OfType<UnrecognizedKeyword>();
var unrecognizedButSupported = Keywords!.Except(keywords).ToArray();

// Process the applicable keywords (determined by the dialect)
// Strangely, this also includes any instances of UnrecognizedKeyword because
//   annotation collection is its normal behavior
foreach (var keyword in keywords.OrderBy(x => x.Priority()))
{
    var keywordConstraint = keyword.GetConstraint(constraint, localConstraints, context);
    localConstraints.Add(keywordConstraint);
}

// Collect annotations for the known keywords that don't need to be processed.
// We have to re-serialize their values.
foreach (var keyword in unrecognizedButSupported)
{
    var typeInfo = SchemaKeywordRegistry.GetTypeInfo(keyword.GetType());
    var jsonText = JsonSerializer.Serialize(keyword, typeInfo!);
    var json = JsonNode.Parse(jsonText);
    var keywordConstraint = KeywordConstraint.SimpleAnnotation(keyword.Keyword(), json);
    localConstraints.Add(keywordConstraint);
}

constraint.Constraints = [.. localConstraints];
```

is now:

```csharp
// Instead of creating lists, we just grab some memory from the pool.
using var constraintOwner = MemoryPool<KeywordConstraint>.Shared.Rent(Keywords!.Count);
var localConstraints = constraintOwner.Memory.Span;
var constraintCount = 0;
using var dialectOwner = MemoryPool<Type>.Shared.Rent();
var declaredKeywordTypes = dialectOwner.Memory.Span;
var i = 0;

// Dialect is determined when the schema is registered (see the next section),
//   so we know exactly which keyword types to process.
if (Dialect is not null)
{
    foreach (var vocabulary in Dialect)
    {
        foreach (var keywordType in vocabulary.Keywords)
        {
            declaredKeywordTypes[i] = keywordType;
            i++;
        }
    }
}
declaredKeywordTypes = declaredKeywordTypes[..i];

var version = DeclaredVersion == SpecVersion.Unspecified ? context.EvaluatingAs : DeclaredVersion;
// Now we only run a single loop through all of the keywords.
foreach (var keyword in Keywords.OrderBy(x => x.Priority()))
{
    KeywordConstraint? keywordConstraint;
    if (ShouldProcessKeyword(keyword, context.Options.ProcessCustomKeywords, version, declaredKeywordTypes))
    {
        keywordConstraint = keyword.GetConstraint(constraint, localConstraints[..constraintCount], context);
        localConstraints[constraintCount] = keywordConstraint;
        constraintCount++;
        continue;
    }

    // We still have to re-serialize values for known keywords.
    var typeInfo = SchemaKeywordRegistry.GetTypeInfo(keyword.GetType());
    var json = JsonSerializer.SerializeToNode(keyword, typeInfo!);
    keywordConstraint = KeywordConstraint.SimpleAnnotation(keyword.Keyword(), json);
    localConstraints[constraintCount] = keywordConstraint;
    constraintCount++;

    constraint.UnknownKeywords?.Add((JsonNode)keyword.Keyword());
}
```

After these changes, `PopulateConstraint()` is still allocating the most memory, but it's less than half of what it was allocating before.

One of the breaking changes actually came out of this update as well.  `IJsonSchemaKeyword.GetConstraint()` used to take an `IEnumerable<T>` of the constraints that have already been processed, but now it takes a `ReadOnlySpan<T>` of them.  This might impact the implementation of a custom keyword, but from my experience with the 93 keywords defined in the solution, it's likely not going to require anything but changing the method signature since most keywords don't rely on sibling evaluations.

## `GetSubschemas()` & `IsDynamic()`

The second largest contributor to allocations was `GetSubschemas()`.  This was primarily because `IsDynamic()` called it... a lot.

`IsDynamic()` is a method that walks down into the schema structure to determine whether a dynamic keyword (either `$recursiveRef` or `$dynamicRef`) is used.  These keywords cannot be fully analyzed statically because, in short, their resolution depends on the dynamic scope, which changes _during_ evaluation and can depend on the instance being evaluated.

> [Juan Cruz Viotti](https://github.com/jviotti) has an excellent [post](https://json-schema.org/blog/posts/understanding-lexical-dynamic-scopes) on the JSON Schema blog that covers lexical vs dynamic scope in depth.  I definitely recommend reading it.
{: .prompt-info }

`IsDynamic()` was a very simple recursive function:

```c#
private bool IsDynamic()
{
    if (BoolValue.HasValue) return false;
    if (Keywords!.Any(x => x is DynamicRefKeyword or RecursiveRefKeyword)) return true;

    return Keywords!.SelectMany(GetSubschemas).Any(x => x.IsDynamic());
}
```

It checks for the dynamic keywords.  If they exist, return true; if not, check the keywords' subschemas by calling `GetSubschemas()` on each of them.

`GetSubschemas()` is a slightly more complicated method that checks a keyword to see if it contains subschemas and return them if it does.  To accomplish this, it used [`yield return` statements](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/yield), which builds an `IEnumerable<T>`.

```c#
internal static IEnumerable<JsonSchema> GetSubschemas(IJsonSchemaKeyword keyword)
{
    switch (keyword)
    {
        // ItemsKeyword implements both ISchemaContainer and ISchemaCollector,
        //   so it's important to make sure the Schema property is actually not null
        //   even though the interface's nullability indicates that it's not.
        case ISchemaContainer { Schema: not null } container:
            yield return container.Schema;
            break;
        case ISchemaCollector collector:
            foreach (var schema in collector.Schemas)
            {
                yield return schema;
            }
            break;
        case IKeyedSchemaCollector collector:
            foreach (var schema in collector.Schemas.Values)
            {
                yield return schema;
            }
            break;
        case ICustomSchemaCollector collector:
            foreach (var schema in collector.Schemas)
            {
                yield return schema;
            }
            break;
    }
}
```

As implemented, these methods (in my opinion) are quite simple and elegant.  However this design has a couple of glaring problems.

1. `IsDynamic` makes no attempt to cache the result, even though `JsonSchema` is immutable and the result will never change.
2. While `yield return` is great for building deferred-execution queries and definitely has its applications (_JsonPath.Net_ actually returns deferred-execution queries), this is not one of those applications, and it does result in considerable memory allocations.

I started with `GetSubschemas()` by converting all of the `yield return` statements to just collecting the subschemas into a `Span<T>`.  This doesn't change the method that much, and it's actually closer to what would have been done before C# had the `yield` keyword.

```c#
private static ReadOnlySpan<JsonSchema> GetSubschemas(IJsonSchemaKeyword keyword)
{
    var owner = MemoryPool<JsonSchema>.Shared.Rent();
    var span = owner.Memory.Span;

    int i = 0;
    switch (keyword)
    {
        // ReSharper disable once RedundantAlwaysMatchSubpattern
        case ISchemaContainer { Schema: not null } container:
            span[0] = container.Schema;
            i++;
            break;
        case ISchemaCollector collector:
            foreach (var schema in collector.Schemas)
            {
                span[i] = schema;
                i++;
            }
            break;
        case IKeyedSchemaCollector collector:
            foreach (var schema in collector.Schemas.Values)
            {
                span[i] = schema;
                i++;
            }
            break;
        case ICustomSchemaCollector collector:
            foreach (var schema in collector.Schemas)
            {
                span[i] = schema;
                i++;
            }
            break;
      }

    return i == 0 ? [] : span[..i];
}
```

Then I started to update `IsDynamic()` to use the refactored `GetSubschemas()`.  (I tried making it iterative instead of recursive, but I couldn't do that very well without allocations, so I just stuck with the recursion.)  As I was working on it, I realized that being able to just get the subschemas of an entire schema would be tidier, so I created that method as well.

```c#
internal ReadOnlySpan<JsonSchema> GetSubschemas()
{
    if (BoolValue.HasValue) return [];

    var owner = MemoryPool<JsonSchema>.Shared.Rent();
    var span = owner.Memory.Span;

    var i = 0;
    foreach (var keyword in Keywords!)
    {
        foreach (var subschema in GetSubschemas(keyword))
        {
            span[i] = subschema;
            i++;
        }
    }

    return i == 0 ? [] : span[..i];
}

private bool IsDynamic()
{
    if (BoolValue.HasValue) return false;
    if (_isDynamic.HasValue) return _isDynamic.Value;

    foreach (var keyword in Keywords!)
    {
        if (keyword is DynamicRefKeyword or RecursiveRefKeyword)
        {
            _isDynamic = true;
            return true;
        }
    }

    foreach (var subschema in GetSubschemas())
    {
        if (subschema.IsDynamic())
        {
            _isDynamic = true;
            return true;
        }
    }

    _isDynamic = false;
    return false;
}
```

This worked... barely.  The tests passed, but the memory allocations skyrocketed.  My benchmark wouldn't finish because it ate all of my RAM.  Some of you may see why.

If you read my last post, I included a warning that `Memory<T>` is disposable and you need to make sure that you dispose of it.  This is how I learned that lesson.  My acquisition of the memory (via the `.Rent()` method) needs to be a `using` declaration (or block).

```c#
using var owner = MemoryPool<JsonSchema>.Shared.Rent();
```

But just making this change made me sad for a different reason: pretty much all of my tests failed.

Then I realized the problem:  making the memory a `using` declaration meant that the memory (and the span that comes with it) was released when the method returned.  But then I'm _returning_ the span... which was released.  That's generally bad.

```c#
internal ReadOnlySpan<JsonSchema> GetSubschemas()
{
    // ...

    using var owner = MemoryPool<JsonSchema>.Shared.Rent();  // memory assigned
    var span = owner.Memory.Span;

    // ...

    return i == 0 ? [] : span[..i];  // memory released; what is returned?!
}
```

> `ref struct`s were introduced partially to solve this problem.
{: .prompt-info }

Instead of making my method return `ref ReadOnlySpan<JsonSchema>`, I opted to pass in the `owner` from the calling method.

```c#
internal ReadOnlySpan<JsonSchema> GetSubschemas(IMemoryOwner<JsonSchema> owner)
{
    // ...

    var span = owner.Memory.Span;

    // ...

    return i == 0 ? [] : span[..i];
}
```

Now the memory is owned by the calling method, which allows that method to read the span's contents before it's released.  This also had an added benefit that I could just rent the memory once and re-use it each time I called `GetSubschemas()`.

Here are the final methods:

```c#
private bool IsDynamic()
{
    if (BoolValue.HasValue) return false;
    if (_isDynamic.HasValue) return _isDynamic.Value;

    foreach (var keyword in Keywords!)
    {
        if (keyword is DynamicRefKeyword or RecursiveRefKeyword)
        {
            _isDynamic = true;
            return true;
        }
    }

    // By renting here, we get to read the span before it's released.
    using var owner = MemoryPool<JsonSchema>.Shared.Rent();
    foreach (var subschema in GetSubschemas(owner))
    {
        if (subschema.IsDynamic())
        {
            _isDynamic = true;
            return true;
        }
    }

    _isDynamic = false;
    return false;
}

internal ReadOnlySpan<JsonSchema> GetSubschemas(IMemoryOwner<JsonSchema> owner)
{
    if (BoolValue.HasValue) return [];

    var span = owner.Memory.Span;

    // By renting here, we get to read the span before it's released.
    // We also get to re-use it for each keyword.
    using var keywordOwner = MemoryPool<JsonSchema>.Shared.Rent();
    var i = 0;
    foreach (var keyword in Keywords!)
    {
        foreach (var subschema in GetSubschemas(keyword, keywordOwner))
        {
            span[i] = subschema;
            i++;
        }
    }

    return i == 0 ? [] : span[..i];
}

private static ReadOnlySpan<JsonSchema> GetSubschemas(IJsonSchemaKeyword keyword, IMemoryOwner<JsonSchema> owner)
{
    var span = owner.Memory.Span;

    int i = 0;
    switch (keyword)
    {
        case ISchemaContainer { Schema: not null } container:
            span[0] = container.Schema;
            i++;
            break;
        case ISchemaCollector collector:
            foreach (var schema in collector.Schemas)
            {
                span[i] = schema;
                i++;
            }
            break;
        case IKeyedSchemaCollector collector:
            foreach (var schema in collector.Schemas.Values)
            {
                span[i] = schema;
                i++;
            }
            break;
        case ICustomSchemaCollector collector:
            foreach (var schema in collector.Schemas)
            {
                span[i] = schema;
                i++;
            }
          break;
    }

    return i == 0 ? [] : span[..i];
}
```

These changes basically removed these methods from Resharper's profiling analysis, meaning they're not allocating enough to bother reporting!

## Wrap up

During my changes to _JsonPointer.Net_, I had paused and transitioned to working in this library.  This is where I learned the most about using `Memory<T>`.

In the next post, I'll go over how I de-spaghettified the schema meta-data analysis code.

_If you like the work I put out, and would like to help ensure that I keep it up, please consider [becoming a sponsor](https://github.com/sponsors/gregsdennis)!_
