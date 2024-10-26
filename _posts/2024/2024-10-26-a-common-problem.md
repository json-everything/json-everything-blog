---
title: "A Common Pitfall of Working with JsonNode"
date: 2024-10-26 09:00:00 +1200
tags: [.net, json, system.text.json, learning]
toc: true
pin: false
---

When anyone publishes a work of creativity, they invite both praise and criticism.  But open source development has a special third category: bug reports.  Sometimes, these "bugs" are really just user error.

In this post I'm going to review what is arguably the most common of these cases: failing to parse string-encoded JSON data.

## The `JsonNode` model 

All of the `json-everything` libraries operate on the `JsonNode` family of models from _System.Text.Json_.  These models offer a remarkable feature that makes inlining JSON data very simple:  implicit casts into `JsonValue` from compatible .Net types.

So, C# `bool` maps to the `true` and `false` JSON literals, [`null` maps to the `null` JSON literal](../2023/null-has-value-too.md), `double` and all of the other numeric types map to JSON numbers, and `string` maps to JSON strings.  That means the compiler considers all of the following code as valid and performs the appropriate conversion in the background:

```c#
JsonNode jsonBool = false;
// in modern C#, you need to qualify that a var can be nullable
JsonNode? jsonNull = null;
JsonNode jsonNumber = 42;
JsonNode jsonString = "my string data"
```

> The cast itself results in a `JsonValue`, which inherits from `JsonNode`.  `JsonObject` and `JsonArray` also derive from `JsonNode`.
{: .prompt-info }

What this enables is a very intuitive approach to building complex JSON in a way that, if you squint just right, looks like the JSON syntax itself:

```c#
// e.g. data for a person
var jsonObject = new JsonObject
{
    ["name"] = "Ross",
    ["age"] = 25,
    ["married"] = false,
    ["friends"] = new JsonArray
    {
        "Rachel",
        "Chandler",
        "Phoebe",
        "Joey",
        "Monica"
    }
}
```

However one of these conversions creates a perfect storm for confusion.

## Falling into the trap

> I'm going to use `JsonE.Evaluate()` for illustration, but since basically all of the `json-everything` libraries expose methods which take `JsonNode` as a parameter, this pitfall applies to them all.
{: .prompt-warning }

Getting straight to the point, the error I see a lot of people making is passing the JSON data as a string into methods that have `JsonNode` parameters.

```c#
var template = """
    {
      "$flatten": [
        [1, 2],
        [3, 4],
        [[5]]
      ]
    }
    """
var result = JsonE.Evaluate(template);
```

These users expect that the template will be interpreted as JSON and processed accordingly, giving the JSON result of `[1, 2, 3, 4, 5]`.  Instead they just get the template back.  Then, because it's not working, they file a bug.  (Some people create a "question" issue, but most people assume something is wrong with the lib.)

Since the compiler, which is supposed to provide guardrails against incorrect typing, reports that everything is fine, they assume the problem must be with the library.  But in this case, `JsonNode`'s implicit cast has subverted the compiler's type-checking in the name of providing a service (easy, JSON-like, inline data building).

## The solution

The user just needs to parse the string-encoded JSON into the `JsonNode` model, and then pass _that_ into the `JsonE.Evaluate()` method.

This can be done in multiple ways, but the primary ones I would use (in order) are:

1. `JsonNode.Parse(jsonText)`
2. `JsonSerializer.Deserialize<JsonNode>(jsonText)`

Both of these will give you a `JsonNode`.  The second is a bit indirect, but it gets the job done, and I'm pretty sure it just ends up calling the first.

## What can be done?

I don't really think anything can be done aside from educating users of _System.Text.Json_.  It's an API decision, and frankly one that I agree with.  When I first built _Manatee.Json_ almost ten years ago, I started with only a JSON DOM that very closely resembled `JsonNode`, including all of the same implicit casts.

It's a very useful API, but it does require knowledge that the cast is happening.

In the end, I assume many of the users who fall into this trap and report a "bug" (or open a question issue) are likely just new to .Net.  Whatever the reason, the best approach to addressing these cases is maintaining an attitude of helpfulness, understanding, and education.

_If you like the work I put out, and would like to help ensure that I keep it up, please consider [becoming a sponsor](https://github.com/sponsors/gregsdennis)!_
