---
title: "Null Has Value, Too"
date: 2023-04-20 09:00:00 +1200
tags: ["null", json, system.text.json]
toc: true
pin: false
---

If you want to build JSON structures in your programming language, you need a data model.  For .Net, that model exists in the
`System.Text.Json.Nodes` namespace as `JsonNode` and its derived types, `JsonObject`, `JsonArray`, and `JsonValue`.  Importantly, you need to make a decision of how to represent JSON `null`.

The designers of `JsonNode` decided to make JSON `null` equivalent to .Net `null`.  This post will explore why I think that was a poor decision.

Much of the content of this post comes from my experience with [Manatee.Json](https://github.com/gregsdennis/Manatee.Json) and conversations with the .Net engineers on this very topic.

- [#66948 - JsonNode/JsonObject not differentiating between missing property and null-value](https://github.com/dotnet/runtime/issues/66948)
- [#68128 - API Proposal: Add JSON null independent of .Net null](https://github.com/dotnet/runtime/issues/68128)

## The structure of JSON

To begin, I'd like to cover how JSON is described in its [specification](https://www.rfc-editor.org/rfc/rfc8259#section-3).  Particularly, I'd like to look at the data model.

There are two structured types, objects and arrays, that are comprised of a set of primitives: numbers, strings, and the literals, `true`, `false`, and `null`.

I'd like to focus on those literals.  The way they're defined, they're just names, symbols without any inherent value.  Often we relate `true` and `false` to a boolean type because the names imply that association, but technically they hold no such meaning.  Similarly, `null` is often used to mean "no value," but that's not the case.  In JSON, "no value" is represented by simply not existing.  In JSON, `null` _is_ a value.

## .Net's data model

The data model that `JsonNode` and family give us represents JSON `null` as .Net `null`.  Because of this, you get a fairly convenient API.  If you want to represent an object with a `null` under the `foo` key, you do this:

```c#
var node = new JsonObject
{
    ["foo"] = null
};
```

Pretty straightforward and easy to use, right?

Similarly, you get `null` when querying the object.

```c#
var valueAtFoo = node["foo"];
```

It all still works.

## It begins to go wrong

One of the features of the `JsonNode` API is that you can find out where in the JSON structure a particular value exists by calling its `.GetPath()` method.  This method returns a JSON Path (BTW, [wrong construct](/posts/paths-and-pointers)) that starts from the root JSON value and leads to the value you have.  That can be pretty handy.

Now, what happens when you use this method to find out where a `null` was?  (Note that `.GetPath()` isn't an extension method.)

```c#
var location = valueAtFoo.GetPath();
```

**BOOM!**  Instant null reference exception.

Imagine you're trying to protect against nulls in your JSON, so want to walk the structure and report any nulls that you find.  You've managed to walk the structure, but when you find a null, now you can't report where it was without manually keeping track of where you've been.  `.GetPath()` is supposed to be able to report where a value is from the value itself, but now you don't have a value.

## Differentiating `null` from "missing"

Now let's say that we want to check our object for a `bar` property.

```c#
var barValue = node["bar"];
```

Most developers would expect that this, like any other dictionary (`JsonObject` does implement `IDictionary<string, JsonValue>`), would throw a `KeyNotFoundException`.

But it doesn't.  It returns `null` for missing keys.

So now, although we know it's absolutely not correct, this holds:

```c#
Assert.AreEqual(node["foo"], node["bar"]);
```

So how are we supposed to determine whether a key exists and holds a `null` or a key just doesn't exist?  We have to use `.TryGetPropertyValue()` or `.ContainsKey()`.  These will return true if the key exists and false if it doesn't.  That means we can't use the nice indexer syntax; we have to use a clunky method.

```c#
if (node.TryGetPropertyValue("foo", out valueAtFoo))
{
    // node exists
}
else
{
    // node doesn't exist
}
```

And for both cases, `valueAtFoo` still comes out as `null`.

### Other odd side effects

This also has an impact on how developers write their code.  If I want to write a method that returns a `JsonNode` and I need to also communicate the presence of a `null` node, then I'm forced to write a `Try`-pattern method.

```c#
public bool TryQuery(JsonNode? node, out JsonNode? result) { ... }
```

instead of

```c#
public JsonNode? Query(JsonNode? node) { ... }
```

Lastly, if I have nullable reference types enabled, then I have to have `JsonNode?` _everywhere_, even when it's supposed to represent a legitimate value (i.e. `null`).

## What's the solution?

Linked above, I presented my proposal to the .Net team as a new `JsonValue`-derived type called `JsonNull` combined with a parsing/deserialization option to use this instead of .Net `null`.  As of this writing the issue is still open.  I don't know if it'll be accepted or not.

Ideally, I'd like to see a `JsonValue` that can represent JSON `null` without itself being null.  Sadly, the design decision they've made means that changing anything to support an explicit representation for JSON `null` in this way would be a breaking change, and they're (understandably) unwilling to do that.

Until my proposal is adopted, or in the event it's rejected, I've created the `JsonNull` type in my _Json.More.Net_ library that contains a single static property:

```c#
public static readonly JsonValue SignalNode = new JsonValue<JsonNull>();
```

Although it only partially solves the problem (it doesn't work for parsing into `JsonNode` or deserialization), this can be used to communicate that the value exists and is `null`.  I use it extensively in the library suite.

## Summary

If you're building a parser and data model for JSON and your language supports the concept of `null`, keep it separate from JSON `null`.  On the surface, it may be convenient, but it'll likely cause problems for someone.
