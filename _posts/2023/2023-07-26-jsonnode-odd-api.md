---
title: "JsonNode's Odd API"
date: 2023-07-26 09:00:00 +1200
tags: [json-path, json-pointer, json-node, oddity]
toc: true
pin: false
---

```c#
var array = new JsonArray
{
    ["a"] = 1,
    ["b"] = 2,
    ["c"] = 3,
};
```

This compiles.  Why does this compile?!

Today we're going to explore that.

## What's wrong?

In case you didn't see it, we're creating a `JsonArray` instance and initializing using key/value pairs.  But arrays don't contain key/value pairs; they contain values.  Objects contain key/value pairs.

```c#
var list = new List<int>
{
    ["a"] = 1,
    ["b"] = 2,
    ["c"] = 3,
};
```

This doesn't compile, as one would expect.  So why does `JsonArray` allow this?  Is the collection initializer broken?

## Collection initializers

Microsoft actually has some really good [documentation](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/object-and-collection-initializers#collection-initializers) on collection initializers so I'm not going to dive into it here.  Have a read through that if you like.

The crux of it comes down to when collection initializers are allowed.  First, you need to implement `IEnumerable<T>` and an `.Add(T)` method (apparently it also works as an extension method).  This will enable the basic collection initializer syntax, like

```c#
var list = new List<int> { 1, 2, 3 };
```

But you can also enable direct-indexing initialization by adding an indexer.  This lets us do thing like

```c#
var list = new List<int>(10)
{
   [2] = 1,
   [5] = 2,
   [6] = 3
};
```

More commonly, you may see this used for `Dictionary<TKey, TValue>` initialization:

```c#
var dict = new Dictionary<string, int>
{
    ["a"] = 1,
    ["b"] = 2,
    ["c"] = 3,
}
```

But, wait... does that mean that `JsonArray` has a string indexer?

## `JsonArray` has a string indexer!

It sure does!  You can see it in the documentation, right there under [Properties](https://learn.microsoft.com/en-us/dotnet/api/system.text.json.nodes.jsonarray?view=net-7.0#properties).

Why?!  Why would you define a string indexer on an array type?

Well, they didn't.  They [defined](https://learn.microsoft.com/en-us/dotnet/api/system.text.json.nodes.jsonnode?view=net-7.0#properties) it and the integer indexer on the base type, `JsonNode`, as a convenience for people working directly with the base type without having to cast it to a `JsonArray` or `JsonObject` first.

But now, all of the `JsonNode`-derived types have both an integer indexer and a string indexer, and it's really weird.  It makes all of this code completely valid:

```c#
JsonValue number = ((JsonNode)5).AsValue();  // can't cast directly to JsonValue
_ = number[5];        // compiles but will explode
_ = number["five"];   // compiles but will explode

JsonArray array = new() { 0, 1, 2, 3, 4, 5, 6 };
_ = array[5];         // fine
_ = array["five"];    // compiles but will explode

JsonObject obj = new() { ["five"] = 1 };
_ = obj[5];           // compiles but will explode
_ = obj["five"];      // fine
```

## Is this useful?

This seems like a very strange API design decision to me.  I don't think I'd ever trust a `JsonNode` enough to confidently attempt to index it before checking to see if it _can_ be indexed.  Furthermore, the process of checking whether it can be indexed can easily result in a correctly-typed variable.

```c#
if (node is JsonArray array)
    Console.WriteLine(array[5]);  
```

This will probably explode because I didn't check bounds, but from a type safety point of view, this is SO much better.

I have no need to access indexed values directly from a `JsonNode`.  I think this API enables programming techniques that are dangerously close to using the `dynamic` keyword, which should be [avoided at all costs](https://www.youtube.com/watch?v=VyGAEbmiWjE).

_If you like the work I put out, and would like to help ensure that I keep it up, please consider [becoming a sponsor](https://github.com/sponsors/gregsdennis)!_
