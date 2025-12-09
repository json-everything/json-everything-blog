---
title: "Rebuilding JsonSchema.Net: The Destination"
date: 2025-12-09 09:00:00 +1200
tags: [.net, json-schema, architecture, performance]
toc: true
pin: false
---

_JsonSchema.Net_ has just undergone a major overhaul.  It's now faster, it uses less memory, it's easier to extend, and it's just more pleasant to work with.

In the [previous post](/posts/rebuilding-jsonschemanet-1), I discussed the motivations behind the change and the architectural concepts applied.  In this post, I'll get into the technical bits.

## The status quo

In the previous design of _JsonSchema.Net_, which started with v5, the idea was to model each keyword as a constraint, and then a schema (or subschema) was merely a collection of these constraints.  A constraint consisted of some validation requirement applying to some location in the instance.  By identifying the constraints, embedding the validation logic in the model, and pre-processing as much as possible, the actual evaluation could happen faster because it already knew _what_ to do; the evaluation was just doing it.

Upon reflection, I think the idea was solid, but some of the choices I made led to unnecessary memory allocations and difficulties when attempting concurrent validations, and, well, just ugly and difficult to use and extend.  I didn't enjoy working in the library, and as a result I avoided fixing some of the issues that were reported.

## A new approach

The new model follows a similar idea: collect information about the keywords and build a model of the schema.  Resolve as much as possible at build time.

However, instead of creating a delegate to perform evaluation, I'd use stateless logic in the form of a singleton handler that I could attach alongside the keyword data.

Instead of using `JsonNode`, which requires an allocation for each node, I'd use `JsonElement`, which uses spans under the hood to reference the original data.

Instead of having a global keyword registry that applied to all schemas throughout the app, I'd implement the concept of a dialect, which is the pool of available keywords, and I'll make the chosen dialect configurable.  More on dialects in a bit.

Instead of hiding the build step inside the evaluation and attempting to manage it myself by guessing what my client, you, might want to do, I'd expose the build step as a separate action and let you manage it yourself.

Instead of deciding for you that `decimal` was the type to use for numeric operations, maybe I could simply operate on the underlying JSON text.  I only need comparisons and divisibility (not division, just "is _x_ divisible by _y_?").

## The schema model

The root still starts with the `JsonSchema` class.  You build a schema through one of the factory methods:

- `.Build(JsonElement)`
- `.FromText(string)`
- `.FromFile(string)`

> Serialization is still supported, but it's can only use the default build options.

Each of these methods also takes a `BuildOptions` object, on which you can declare the dialect you want to use and registries which define the collection of dialects, schemas, and vocabularies you want to be available during the build.  Each one of the registries defaults to a global registry, and any lookups also fall back to the global registry if the item isn't found locally.

Once built, the schema object is immutable.

By encapsulating the build dependencies this way, you can build the same schema JSON text against different options to get different behaviors.  For example, if you want to run a schema as the Draft 7 specification and then later as the Draft 2020-12 specification, you can: you just need to build it twice, once each setting the respective dialect in the build options.

Dialects are also auto-selected when encountering a `$schema` keyword.  The dialect is looked up, and if it's registered, then it just uses those keywords.  If that dialect isn't registered, then it looks for the meta-schema in the schema registry, and checks for a `$vocabulary` keyword.  If that succeeds, it can dynamically build the dialect for you, supposing the appropriate vocabularies are registered; otherwise, and exception is thrown.

Keywords are supported with singleton handlers.  This singleton implements logic for validating the keyword data itself, building subschemas, and evaluating an instance.  In previous versions, when a keyword's behavior has evolved over the various specification, there would be a single keyword type that handled all of the different flavors.  Now, there's a handler for each different behavior.  This keeps the logic very simple in each one, and it makes composing the logic into a dialect very easy.  If keyword validation fails, an exception is thrown.

Inside `JsonSchema`, there is a `JsonSchemaNode` which is the actual root of the graph.  This contains information about where in the schema we are, relative to the root, and information on any keywords in the subschema that were supported by the dialect.  Keyword information is provided by the `KeywordData` struct, which identifies the keyword name, a reference to the handler, and a list of subschemas, which are represented by further nodes.

Once the schema is navigated, and all of the nodes and keywords are built, the build process checks the graph for cycles and attempts to resolve references.  If a cycle is detected, an exception is thrown.  If a reference cannot be resolved, it will continue.

The last step during the build is adding itself to the schema registry found on the build options, which default to the global registry.

> Allowing the references to remain unresolved handles situations where two schemas reference each other.  For example, you could have _Schema A_ define a property which is validated by _Schema B_ which in turn has a property which is validated by _Schema A_.  When _Schema A_ is built, the reference is left unresolved.  When _Schema B_ is built, the process of resolving its references will drill down into _Schema A_, resolving its reference back to _Schema B_.

If a schema that has not been fully resolved is used to perform an evaluation, an exception will be thrown.
{: .prompt-info }

### Supporting custom keywords

In the old model, keywords needed to

- implement `IJsonSchemaKeyword` to enable processing
- add `[SchemaKeyword]` attribute to identify the keyword name
- add `[SchemaSpecVersion]` attribute for all appropriate versions of the spec
- add `[Vocabulary]` attribute for the vocabulary that defines the keyword
- add `[DependsOnAnnotationsFrom]` attribute to identify keywords that needed to be processed first
- add `[JsonConverter]` attribute for JSON deserialization

The implementation of the interface was particularly difficult to think through.  It required that you build a constraint object that held a delegate that captured the keyword data (generally creating a closure).  Some of these keyword implementations were extremely difficult to get working just right.  Once I had it, I didn't want to touch it.  Just looking at it wrong might cause it to fail.

The new model is much simpler.

- implement `IKeywordHandler`
- maybe make it a singleton
- `[DependsOnAnnotationsFrom]` is still around just in case

The new interface is literally just three methods:

- validate the keyword value, throw an exception if invalid
- build any subschemas, most keywords are a no-op
- evaluate an instance and return a `KeywordEvaluation` result

With the new model, you have access to the local schema's raw data in the form of a `JsonElement`, so a lot of the keyword dependencies can be sorted out before evaluation time and without actually having that dependency.  For example, in the old system, `additionalProperties` needed the annotation results from `properties`.  Now, it just looks at the `properties` value in the raw data and grabs the property list directly.

Instead of registering the keyword with the `SchemaKeywordRegistry`, you just create a dialect that includes your keyword instance, and use that on the build options.

### JSON math

Admittedly, this was coded purely by AI, but I was immediately sure to test it thoroughly.

The `JsonMath` static class performs numeric comparisons and divisibility tests on numbers while they're still encoded in the `JsonElement`.  No parsing into a numeric type means that we now fully support arbitrary size and precision.

Of course, you'll need to deserialize the value in to whatever model you need for your application, but the benefit is that you get to decide which numeric type is right.

### No more serialization

The primary way to get a schema was to deserialize it.  This meant jumping through a lot of hoops to get keywords to deserialize properly.  And then trying to make that whole system AOT-compatible was an absolute pain (that I was very glad to have help on).

Instead everything is built directly from a `JsonElement`, and each part saves the source element, so returning back to JSON is basically already done.

## Performance

I had spent a lot of time with the previous iteration, doing a lot of gross hacking to utilize array pools and stack-allocated arrays to squeeze out every microsecond of performance.  It was pretty quick, but there wasn't anything I could do with it in its current state.

When I was done with the rebuild, I ran a benchmark that built a moderate schema and ran it through the build and evaluation processes.  For one test, I had it build and evaluate each iteration, and for the other, I had it build once and evaluate repeatedly.  I implemented the benchmark for both versions.

Here are the tests for v7:

| Method      | Runtime   | n  | Mean      | Gen0     | Gen1   | Allocated  |
|------------ |---------- |--- |----------:|---------:|-------:|-----------:|
| BuildAlways | .NET 8.0  | 5  |  64.33 us |  14.4043 | 0.4883 |  119.15 KB |
| BuildAlways | .NET 9.0  | 5  |  58.50 us |  13.9160 | 0.4883 |  114.69 KB |
| BuildAlways | .NET 10.0 | 5  |  61.78 us |  13.6719 | 0.4883 |  112.04 KB |
|             |           |    |           |          |        |            |
| BuildAlways | .NET 8.0  | 10 | 130.92 us |  28.3203 | 0.9766 |  238.29 KB |
| BuildAlways | .NET 9.0  | 10 | 117.20 us |  27.3438 | 0.9766 |  229.39 KB |
| BuildAlways | .NET 10.0 | 10 | 109.07 us |  27.3438 | 0.4883 |  225.64 KB |
|             |           |    |           |          |        |            |
| BuildAlways | .NET 8.0  | 50 | 668.65 us | 144.5313 | 3.9063 | 1191.47 KB |
| BuildAlways | .NET 9.0  | 50 | 596.34 us | 139.6484 | 4.8828 | 1146.93 KB |
| BuildAlways | .NET 10.0 | 50 | 548.28 us | 136.7188 | 3.9063 | 1120.37 KB |
|             |           |    |           |          |        |            |
| BuildOnce   | .NET 8.0  | 5  |  33.29 us |   8.4229 | 0.2441 |   69.39 KB |
| BuildOnce   | .NET 9.0  | 5  |  30.16 us |   8.1787 | 0.2441 |    67.1 KB |
| BuildOnce   | .NET 10.0 | 5  |  26.86 us |   7.8125 | 0.2441 |   64.78 KB |
|             |           |    |           |          |        |            |
| BuildOnce   | .NET 8.0  | 10 |  58.78 us |  15.3809 | 0.4883 |  126.35 KB |
| BuildOnce   | .NET 9.0  | 10 |  53.01 us |  14.8926 | 0.4883 |  122.29 KB |
| BuildOnce   | .NET 10.0 | 10 |  47.51 us |  14.4043 | 0.4883 |  117.95 KB |
|             |           |    |           |          |        |            |
| BuildOnce   | .NET 8.0  | 50 | 249.25 us |  70.8008 | 1.9531 |     582 KB |
| BuildOnce   | .NET 9.0  | 50 | 226.23 us |  68.8477 | 2.1973 |  563.88 KB |
| BuildOnce   | .NET 10.0 | 50 | 211.27 us |  66.4063 | 1.9531 |  543.29 KB |

and for v8:

| Method      | Runtime   | n  | Mean      | Gen0     | Gen1    | Allocated |
|------------ |---------- |--- |----------:|---------:|--------:|----------:|
| BuildAlways | .NET 8.0  | 5  |  80.87 us |  11.9629 |  3.9063 |   98.4 KB |
| BuildAlways | .NET 9.0  | 5  |  74.84 us |  10.8643 |  3.1738 |  89.06 KB |
| BuildAlways | .NET 10.0 | 5  |  99.24 us |  10.7422 |  3.1738 |  89.22 KB |
|             |           |    |           |          |         |           |
| BuildAlways | .NET 8.0  | 10 | 161.28 us |  23.9258 |  7.3242 |  196.8 KB |
| BuildAlways | .NET 9.0  | 10 | 152.47 us |  21.4844 |  6.3477 | 178.13 KB |
| BuildAlways | .NET 10.0 | 10 | 142.67 us |  21.4844 |  6.3477 | 178.44 KB |
|             |           |    |           |          |         |           |
| BuildAlways | .NET 8.0  | 50 | 818.38 us | 120.1172 | 40.0391 | 983.98 KB |
| BuildAlways | .NET 9.0  | 50 | 756.01 us | 108.3984 | 31.2500 | 890.63 KB |
| BuildAlways | .NET 10.0 | 50 | 704.13 us | 108.3984 | 31.2500 | 892.19 KB |
|             |           |    |           |          |         |           |
| BuildOnce   | .NET 8.0  | 5  |  31.72 us |   6.9580 |  1.7090 |  57.27 KB |
| BuildOnce   | .NET 9.0  | 5  |  28.76 us |   6.4697 |  1.5869 |  53.59 KB |
| BuildOnce   | .NET 10.0 | 5  |  25.41 us |   6.4697 |  1.5869 |  53.63 KB |
|             |           |    |           |          |         |           |
| BuildOnce   | .NET 8.0  | 10 |  53.64 us |  12.6953 |  2.1973 | 104.27 KB |
| BuildOnce   | .NET 9.0  | 10 |  47.20 us |  11.9629 |  2.9297 |  98.32 KB |
| BuildOnce   | .NET 10.0 | 10 |  41.21 us |  11.9629 |  2.9297 |  98.35 KB |
|             |           |    |           |          |         |           |
| BuildOnce   | .NET 8.0  | 50 | 212.17 us |  58.5938 |  2.9297 |  480.2 KB |
| BuildOnce   | .NET 9.0  | 50 | 190.14 us |  55.6641 |  2.9297 | 456.13 KB |
| BuildOnce   | .NET 10.0 | 50 | 158.25 us |  55.6641 |  2.9297 | 456.16 KB |

The times are roughly the same across everything, and I don't think you'll really notice a difference, except for a couple things I'd like to highlight.

### Build once, evaluate a lot

This trend is true for both versions, so I'll stick with the v8 numbers.

| Method      | Runtime   | n  | Mean      | Gen0     | Gen1    | Allocated |
|------------ |---------- |--- |----------:|---------:|--------:|----------:|
| BuildAlways | .NET 10.0 | 50 | 704.13 us | 108.3984 | 31.2500 | 892.19 KB |
| BuildOnce   | .NET 10.0 | 50 | 158.25 us |  55.6641 |  2.9297 | 456.16 KB |

It should be obvious, but not having to build a schema every time is definitely the way to go.

### Better performance for v8 over volume

| Version | Method      | Runtime   | n  | Mean      | Gen0     | Gen1    | Allocated |
|--- |------------ |---------- |--- |----------:|---------:|--------:|----------:|
| v7 | BuildOnce   | .NET 10.0 | 5  |  26.86 us |   7.8125 |  0.2441 |   64.78 KB |
| v7 | BuildOnce   | .NET 10.0 | 10 |  47.51 us |  14.4043 |  0.4883 |  117.95 KB |
| v7 | BuildOnce   | .NET 10.0 | 50 | 211.27 us |  66.4063 |  1.9531 |  543.29 KB |
| v8 | BuildOnce   | .NET 10.0 | 5  |  25.41 us |   6.4697 |  1.5869 |   53.63 KB |
| v8 | BuildOnce   | .NET 10.0 | 10 |  41.21 us |  11.9629 |  2.9297 |   98.35 KB |
| v8 | BuildOnce   | .NET 10.0 | 50 | 158.25 us |  55.6641 |  2.9297 |  456.16 KB |

The performance gained in the long term over increasing evaluations is greater for v8.  It scales better.

## It's a better life

The new implementation is so much easier to work with.  It's easier to implement custom keywords and create custom dialects.  That it actually performs better is just icing on the cake.

Building this new version has been a great learning experience, and honestly I couldn't be happier with it.  The knowledge and understanding I gained from taking the time to investigate the static analysis has made me a better devloper overall.  I encourage everyone to occasionally take a moment, step back, and really consider what you're building.  You never know what you'll uncover.

_If you like the work I put out, and would like to help ensure that I keep it up, please consider [becoming a sponsor](https://github.com/sponsors/gregsdennis)!_
