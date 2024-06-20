---
title: "Correction: JSON Path vs JSON Pointer"
date: 2023-07-22 09:00:00 +1200
tags: [json-path, json-pointer]
toc: true
pin: false
---

In my [post](/posts/paths-and-pointers/) comparing JSON Path and JSON Pointer, I made the following claim:

> A JSON Pointer can be expressed as a JSON Path only when all of its segments are non-numeric keys.

Thinking about this a bit more in the context of the [upcoming JSON Path specification](/posts/json-path-spec/), I realized that this only considers JSON Path segments that have one selector.  If we allow for multiple selectors, and the specification does, then we can write `/foo/2/bar` as:

```jsonpath
$.foo[2,'2'].bar
```

## Why this works

The `/2` segment in the JSON Pointer says

- If the value is an array, choose the item at index 2.
- If the value is an object, choose the value under property "2".

So to write this as a path, we just need to consider both of these options.

- If the value is an array, we need a `[2]` to select the item at index 2.
- If the value is an object, we need a `["2"]` to select the value under property "2".

Since the value cannot be both an array and an object, having both of these selectors in a segment `[2,"2"]` is guaranteed not to cause duplicate selection, and we're still guaranteed to get a single value.

### Caveat

While this path _is_ guaranteed to yield a single value, it's still not considered a "Singular Path" according to the syntax definition in the specification.

I raised this to the team, and we ended up [adding a note](https://github.com/ietf-wg-jsonpath/draft-ietf-jsonpath-base/pull/482) to clarify.

## Summary

A thing that I previously considered impossible turned out to be possible.

I've added a note to the original post summarizing this as well as linking here.

_If you like the work I put out, and would like to help ensure that I keep it up, please consider [becoming a sponsor](https://github.com/sponsors/gregsdennis)!_
