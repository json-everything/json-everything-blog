---
title: "More Performance Updates"
date: 2024-04-26 09:00:00 +1200
tags: [json-pointer, json-patch, json-schema, architecture, performance]
toc: true
pin: false
---

I've been focused on performance, specifically memory management, a lot recently.  My latest target has been _JsonPointer.Net_.

I've made a significant update that I hope will make everyone's day a little better.  This post explores the architectural differences and the fallout of the changes in the other libs.

## Regarding performance

Parsing numbers are _way_ down!

This benchmark measures parsing the set of pointers in the spec _n_ times.

| Version| n     | Mean       | Error     | StdDev     | Gen0     | Allocated |
|------- |------ |-----------:|----------:|-----------:|---------:|----------:|
| v4.0.1 | 1     |   2.778 us | 0.0546 us |  0.1025 us |   4.1962 |   8.57 KB |
| v5.0.0 | 1     |   1.718 us | 0.0335 us | 0.0435 us  |   1.4915 |   3.05 KB |
| v4.0.1 | 10    |  26.749 us | 0.5000 us |  0.7330 us |  41.9617 |   85.7 KB |
| v5.0.0 | 10    |  16.719 us | 0.3219 us | 0.4186 us  |  14.8926 |  30.47 KB |
| v4.0.1 | 100   | 286.995 us | 5.6853 us | 12.5983 us | 419.4336 | 857.03 KB |
| v5.0.0 | 100   | 157.159 us | 2.5567 us | 2.1350 us  | 149.1699 | 304.69 KB |

Run time is down 45% and memory allocations are down 65%!

But... that's just parsing.  Pointer math times actually went up.

This benchmark takes those same pointers and just combines them to themselves.

| Version| n     | Mean        | Error       | StdDev      | Gen0     | Allocated |
|------- |------ |------------:|------------:|------------:|---------:|----------:|
| v4.0.1 | 1     |    661.2 ns |    12.86 ns |    11.40 ns |   1.1473 |   2.34 KB |
| v5.0.0 | 1     |   1.912 us  | 0.0376 us   | 0.0586 us   |   1.1101 |   2.27 KB |
| v4.0.1 | 10    |  6,426.4 ns |   124.10 ns |   121.88 ns |  11.4746 |  23.44 KB |
| v5.0.0 | 10    |  18.830 us  | 0.3746 us   | 0.4600 us   |  11.1084 |  22.73 KB |
| v4.0.1 | 100   | 64,469.6 ns | 1,309.01 ns | 1,093.08 ns | 114.7461 | 234.38 KB |
| v5.0.0 | 100   | 188.406 us  | 3.6606 us   | 5.1317 us   | 111.3281 | 227.34 KB |

The run time just about tripled, but the memory usage went down slightly.  We'll talk about the reason behind the increase in the next section about the architecture changes.

## A new architecture and a new API

In previous versions, `JsonPointer` was a class that held multiple `PointerSegment`s, and each `PointerSegment` held the decoded string.  Whenever you needed the full pointer, the segments would be re-encoded and concatenated.  To help matters, it would cache this string, so if you needed the full pointer again, it would just give you the previously calculated value.

In v5, `JsonPointer` is a struct that holds the entire pointer as a string along with an array of `Range` structs which provide the indices in the string for each segment.  The string and array are still on the heap, but they're the only memory that needs allocating.  And when parsing, the string is already provided by the user.

### Combining pointers

In previous versions, when one pointer needed to be concatenated with another pointer (or any additional segments), the resulting pointer could just take the `PointerSegment` instances it wanted without having to allocate new ones.  That means that multiple pointers can actually share `PointerSegment` instances.

However, because the new architecture just stores the entire string, it has to basically build a new string and then parse the whole thing to get the new ranges.  This explains the longer run time and why the memory improvement isn't as significant.

I'm continuing to work on this, and hopefully I'll have updates out soon to address this.

### API changes

As mentioned, `JsonPointer` is now a struct (as is `RelativeJsonPointer`).

I've also replaced the `.Segments` collection with a `.SegmentCount` property and an indexer that gets you the `ReadOnlySpan<char>` that represents the pointer-encoded segment.

To address that you're not getting decoded string segments, I've also defined some extension methods:

- `.SegmentEquals()` - an allocation-free string comparison extension on `ReadOnlySpan<char>` that accounts for JSON Pointer's need to encode the `~` and `/` characters.
- `.GetSegmentName()` - decodes a segment into a string.
- `.GetSegmentIndex()` - parses the segment int an int (int segments don't have to worry about encoding though).

## Fallout

While that sums up the changes made to JSON Pointer, it caused a few changes in both _JsonPatch.Net_ and _JsonSchema.Net_.

The update didn't cause any API changes in _JsonPatch.Net_, so I'm not going really cover it except to say that it was updated.  There was some internal code I had to change, but that's it.

But when I updated _JsonSchema.Net_, it seemed a good time to make some other changes that I discovered while trying to apply the [model-less paradigm](./logic-without-models) to evaluating schemas.

> You can view and play with the new concept in my [schema/experiment-modelless-schema](https://github.com/gregsdennis/json-everything/tree/schema/experiment-modelless-schema) branch.
{: .prompt-info }

While those updates did result in a few breaking changes, like the previous few major versions, unless you're building your own keywords, it's not likely going to affect you much.

## _JsonSchema.Net_ updates

While I can say that the performance noticeably improved, it's not quite as much as I had hoped.  I think part of that is the pointer math problem I mentioned before; evaluating schemas _does_ do a lot of pointer math.  So if I can figure that out, evaluating schemas will just benefit.

### Performance

This benchmark runs the JSON Schema Test Suite _n_ times.

| Version  | n  | Mean       | Error    | StdDev   | Gen0        | Gen1       | Allocated |
|----------|--- |-----------:|---------:|---------:|------------:|-----------:|----------:|
| v6.1.0   | 1  |   412.7 ms | 14.16 ms | 41.30 ms |  27000.0000 |  1000.0000 |  82.66 MB |
| v7.0.0   | 1  | 301.6 ms   |  5.93 ms | 10.07 ms |  23000.0000 | 7000.0000  |  78.41 MB |
| v6.1.0   | 10 | 1,074.7 ms | 22.24 ms | 63.82 ms | 218000.0000 | 11000.0000 | 476.56 MB |
| v7.0.0   | 10 | 945.9 ms   | 18.64 ms | 32.15 ms | 216000.0000 | 5000.0000  | 472.94 MB |

The improvements are

- single evaluation - 27% reduced run time / 5% reduced allocations
- repeated evaluations - 22% reduced run time / negligible allocation reduction

I was really hoping for more out of this exercise, but something is... something.  And as with JSON Pointer, I'll keep working on it.

### API changes

After the change to perform static analysis by gathering reusable constraints, the code started to spaghettify a bit, and I needed to do some refactoring internally to reign that in.  Unfortunately, some of that refactoring spilled out into the public API.

#### `IJsonSchemaKeyword`

The first is a slight change to `IJsonSchemaKeyword.GetConstraint()`.  One of the parameters provides access to constraints that have been previously generated (i.e. dependent keywords).  While this was a read-only list, due to some memory management updates, it's now a read-only span.  I was able to update most of my keywords just by changing the parameter in the method signature.

#### Schema meta-data

Previously, I was storing all of the schema meta-data, like anchors, on the schema itself, but in my experiments, I discovered that it made sense to move that stuff to the schema registry.  This meant that the registry could perform a lot of stuff at registration time that would have otherwise be done at evaluation time:

- scan for anchors (found in `$id`, `$anchor`, `$recursiveAnchor`, and `$dynamicAnchor`)
- set base URIs
- set spec versions (determined by `$schema`)
- set dialect (determined by meta-schema's `$vocabuary`)

Since this data is now identified through a one-time static analysis, I don't have to calculate it at evaluation time.

#### Vocabulary registry

The schema registry follows a "default pattern" where there's a single static instance, `.Global`, but there are also local instances on the evaluation options.  Searching the local one will automatically search the global one as a fallback.  It's really quite useful for when you want to register the dependent schemas for an evaluation, but you don't want all evaluations to have access to them.

I had followed this same pattern with vocabularies as well.  However reflecting on it, I think I was over-engineering.  The keyword registry is static, and it made sense that the vocabulary registry should also be static.

So now it is.

As a result, it's also been removed from the evaluation options.


## Sum-up

Overall, I'm happy with the direction the libraries are going.  I still have some work to do to get the performance better, but I feel the improvements I've made so far are worth putting out there.
