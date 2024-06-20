---
title: "Lessons in Memory Management"
date: 2024-05-03 09:00:00 +1200
tags: [architecture, performance, learning]
toc: true
pin: false
---

[Last time](/posts/better-json-pointer/), I took you through the developer's journey I had while updating _JsonPointer.Net_ and how taking time to really consider my new architecture resulted in completely overhauling the library a second time before publishing it, which yielded a much better outcome.

In this post, I'd like to go over some of the more technical things I learned trying to make the library consume less memory.

> Please note that what I reveal in this post is _not_ to be taken as expert advice.  This is very much a new area of .Net for me, and I still have quite a bit to learn about best practices and the intended use for the memory management tools that .Net provides.
{: .prompt-warning }

## Why allocate less memory?

Allocating memory is making a request to the system to go out to the heap to find a block of memory that is sufficient for your task.  It then has to reserve that memory, which often means negotiating with the OS.

Releasing memory (in .Net and other managed frameworks) is eliminating references to an object so that the garbage collector (GC) can identify it as unused but allocated.  Then it has to talk with the OS again to let it know that the block of memory is now available.

In between those two operations, the GC is doing a lot to ensure that the memory that needs to stay around does so and the memory that can be reclaimed is.  The biggest detractor from performance, though, is that in order to do any of this, it has to essentially pause the application.  And it does this a lot.

All of this takes time.  So the general concept is: fewer allocations means less for the GC to do during the pause, which resumes your application faster.

> The internet is full of ["how garbage collection works in .Net"](https://www.google.com/search?q=how+garbage+collection+works+in+.net) posts, so I'm not going to cover that.  The above is a sufficient understanding to convey why allocating less improves performance.
{: .prompt-tip }

## What types allocate memory?

Most of the types we use allocate memory on the heap.  If it's a class, it lives on the heap.  A struct, if it's just a variable, parameter, or return value, will generally live on the stack, but there are exceptions.

- A struct as a member of any data that's on the heap will also be on the heap.  Think of an `int` field inside of a class, like `List<T>.Count`.
- Arrays and pretty much all collection types are classes, so they live on the heap, even if they're comprised of structs.  So `int[]` lives on the heap.

This is a typical entry-level .Net developer interview question.

When talking about reducing allocations, we're generally talking about heap allocations because that's the stuff that the GC has to take time to manage.

In my first refactor for _JsonPointer.Net_, I made `JsonPointer` a struct, thinking it would allocate less memory by living on the stack.  What I failed to realize was that inside the pointer, I was still holding a string (which is a class) and a `Range[]` (which is also a class).  So while the pointer itself lived on the stack, it still contained two fields which pointed to heap memory, and allocating a new `JsonPointer` still allocated heap memory for the fields.  Making the _container_ a struct in order to save an allocation is like taking a spoonful of water out of a rising river in order to prevent a flood, but then advertising that you're being helpful.

## Enhancement #1 - Don't use extra objects

As mentioned in the previous post, `JsonPointer` was implemented as a container of `PointerSegment`s, which itself was a container of strings that also handled JSON Pointer escaping.  As far as data is concerned, `PointerSegment` isn't adding any value.  It doesn't collect multiple related pieces of data together; it only has one piece of data.  So I've removed it from the model.

That means `JsonPointer` directly holds a collection of strings, and I need to move all of the encoding logic either into `JsonPointer` or into extension methods.  (They're internal so it doesn't really matter where.)

That's pretty much the enhancement: get rid of parts of your data model that you don't need.  But completely eliminating `PointerSegment` presents a small problem.  `JsonPointer` declares a `.Create()` method that takes a parameterized array of segments, and those segments can either be strings or integers, interchangeably.

```c#
var pointer1 = JsonPointer.Create("foo", 3, "bar");
var pointer2 = JsonPointer.Create( 5, "foo", "bar");
```

If C# had union types I could easily just declare the parameter type to be a union of `string` and `int`:

```c#
public static JsonPointer Create(params <string|int>[] segments) { ... }
```

But that's not a thing C# has.

I also can't create an implicit conversion between from `int` to `string` because I don't own either of those types.  (Plus, it would perform that conversion _everywhere_ not just in my method, which would be really bad.)

Instead, I kept `PointerSegment` around.  I made it a struct so it doesn't require an allocation, and I defined implicit casts from `string` and `int` (which just converts it to a string).

Now, I know what you're thinking.  I just wrote this big paragraph about how making `JsonPointer` a struct didn't make sense because its data lived on the heap, and now I'm doing exactly that.  Well... yeah, and I'm doing it on purpose.

The string that it carries will have needed to be allocated anyway.  If the segment was created from a string, no additional allocation; if it was created from an integer, then there's a small allocation for the `int` → `string` conversion.  But once that string is allocated, it's not allocated again later.

Further, I can now write my `.Create()` method to take a parameterized array of `PointerSegment`s, and the compiler will do the work of converting them _without an allocation for the segment itself_.

```c#
public static JsonPointer Create(params PointerSegment[] segments) { ... }
```

## Enhancement #2 - Building collections (known size)

When we need to build a collection of things in .Net, we typically use:

- something from the `System.Collections.Generic` namespace, like `List<T>` or `Dictionary<TKey, TValue>`
- LINQ operations like `.Select()`, `.Where()`, and (one of my favorites) `.Join()`
- or both

These provide an easy way to build, query, and otherwise manage collections of things.  But most of these are implemented as classes, so they live on the heap.

For pointer math (combining pointers / adding segments), I know how many strings I need because each pointer already has an array of strings; I just need to combine those arrays.  This means that I can just directly allocate the right-sized array and fill it.

```c#
var newArray = new string[this._segments.Length + other._segments.Length];
```

To fill it, instead of using a `for` loop, I use the `Array.Copy()` methods to copy the segments in a couple chunks.

```c#
Array.Copy(this._segments, newArray, this._segments.Length);
Array.Copy(other._segments, 0, newArray, this._segments.Length, other._segments.Length);
```

That's it.

Honestly, I don't think this really suffers much in terms of readability.  Here's the LINQ for comparison:

```c#
var newArray = this._segments.Concat(other._segments).ToArray();
```

While the LINQ is more concise, the array logic still lets you know what's going on while really selling the message that performance is a critical concern.

> During the journey here, I had initially used the approach in the next section for pointer math.  Then I realized that I already new how many elements I needed, so I switched to `stackalloc`, wanting to keep building my collection on the stack.  Finally, I realized I can just instantiate the array I needed and fill it directly.  Development really is a journey; don't be afraid to experiment a bit.
{: .prompt-info }

## Enhancement #3 - Building collections (unknown size)

During parsing, I need a dynamic collection (meaning I don't know what size it needs to be) in which I can temporarily store segment strings, which means that I can't use an array.  But I don't want to allocate a `List<string>` to hold them, especially since I'm just going to convert that list to an array by the end of it.  What I need here is a pre-allocated array of slots where I can put pointers to strings.

`Memory<string>` is the tool I want to use in this case, and I can either create a new one or get one out of the [memory pool](https://learn.microsoft.com/en-us/dotnet/api/system.buffers.memorypool-1?view=net-8.0).

```c#
using var memory = MemoryPool<string>.Shared.Rent();
```

> Take notice that `Memory<T>` is disposable.  At one point, I didn't have a `using` declaration and my memory usage went up 20x!  Be sure you release this when you're done with it!
{: .prompt-warning }

The memory I rented exposes a `Span<string>` (not read-only), and spans are `ref struct`s so, they _must_ live on the stack.  They're not allowed on the heap.

```c#
var span = memory.Memory.Span;
```

While debugging, I discovered that this pre-allocates 512 slots for me to fill, which is very likely _way_ more than I'd ever need.  The `Rent()` method does take an optional size parameter, but it's a _minimum_ size, so I'm not sure if it ends up allocating less.  Regardless, the idea here is that the memory is already allocated (or at least it's allocated once), and I can re-use it when I need to through the memory pool.

Now I have an "array" to fill up, which is just the parsing logic.  When I'm done, I just need to cut it down to a right-sized span and create an actual array, leaving the strings, the final array, and the `JsonPointer` itself as the only allocations.

```c#
string[] newArray = [..span[segmentCount]];
```

No allocations performed in processing!

## Wrap up

These were the big things that helped me make _JsonPointer.Net_ much more memory-efficient.  And since JSON Patch and JSON Schema rely on JSON Pointers, those libraries caught the benefit immediately.

Next time, I'm going to review some of the additional _JsonSchema.Net_ improvements I made for v7.0.0.

_If you like the work I put out, and would like to help ensure that I keep it up, please consider [becoming a sponsor](https://github.com/sponsors/gregsdennis)!_
