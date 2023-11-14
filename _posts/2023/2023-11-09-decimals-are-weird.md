---
title: ".Net Decimals are Weird"
date: 2023-11-14 09:00:00 +1200
tags: [json-node, oddity]
toc: true
pin: false
---

I've discovered another odd consequence of what is probably fully intentional code:  `4m != 4.0m`.

Okay, that's not strictly true, but it does seem so if you're comparing the values in JSON.

```c#
var a = 4m;
var b = 4.0m;

JsonNode jsonA = a;
JsonNOde jsonB = b;

// use .IsEquivalentTo() from Json.More.Net
Assert.True(jsonA.IsEquivalentTo(jsonB));    // fails!
```

What?!

_This took me so long to find..._

## What's happening ([brother](https://www.youtube.com/watch?v=tvjrSU9RaPs))

The main insight is contained in [this StackOverflow answer](https://stackoverflow.com/a/13770183/878701).  `decimal` has the ability to retain significant digits!  Even if those digits are expressed in code!!

So when we type `4.0m` in C# code, the compiler tells `System.Decimal` that the `.0` is important.  When the value is printed (e.g. via `.ToString()`), even without specifying a format, you get `4.0` back.  And this includes when serializing to JSON.  If you debug the code above, you'll see that `a` has a value of `4` while `b` has a value of `4.0`.  Even before it gets to the `JsonNode` assignments.

While this doesn't affect _numeric_ equality, it could affect equality that relies on the string representation of the number (like in JSON).

## How this bit me

In developing a new library for [JSON-e](https://json-e.js.org/) support (spoiler, I guess), I found a test that was failing, and I couldn't understand why.

I won't go into the full details here, but JSON-e supports expressions, and one of the tests has the expression `4 == 3.2 + 0.8`.  Simple enough, right?  So why was I failing this?

When getting numbers from JSON throughout all of my libraries, I chose to use `decimal` because I felt it was more important to support JSON's arbitrary precision with `decimal`'s higher precision rather than using `double` for a bit more range.  So when parsing the above expression, I get a tree that looks like this:

```
      ==
    /    \
   4      +
        /   \
      3.2   0.8
```

where each of the numbers are represented as `JsonNode`s with `decimals` underneath.

When the system processes `3.2 + 0.8`, it gives me `4.0`.  As I said before, numeric comparisons between `decimal`s work fine.  But in these expressions, `==` doesn't compare just numbers; it compares `JsonNode`s.  And it does so using my `.IsEquivalentTo()` extension method, found in _Json.More.Net_.

## What's wrong with the extension?

When I built the extension method, I already had one for `JsonElement`.  (It handles everything correctly, too.)  However `JsonNode` doesn't always store `JsonElement` underneath.  It can also store the raw value.

This has an interesting nuance to the problem in that if the `JsonNode`s are parsed:

```c#
var jsonA = JsonNode.Parse("4");
var jsonB = JsonNode.Parse("4.0");

Assert.True(jsonA.IsEquivalentTo(jsonB));
```

the assertion passes because parsing into `JsonNode` just stores `JsonElement`, and the comparison works for that.

So instead of rehashing all of the possibilities of checking strings, booleans, and all of the various numeric types, I figured it'd be simple enough to just `.ToString()` the node and compare the output.

And it worked... until I tried the expression above.  For **18 months** it's worked without any problems.  Such is software development, I suppose.

## It's fixed now

So now I check explicitly for numeric equality by calling `.GetNumber()`, which checks all of the various .Net number types returns a `decimal?` (null if it's not a number).

There's a new [_Json.More.Net_](https://www.nuget.org/packages/Json.More.Net/) package available for those impacted by this (I didn't receive any reports).

And that's the story of how creating a new package to support a new JSON functionality showed me how 4 is not always 4.
