---
title: "Full Native AOT support for _JsonSchema.Net.Generation_ via Source Generators"
date: 2026-02-08 09:00:00 +1200
tags: [project, support]
toc: true
pin: false
excerpt: Compile-time generation of JSON Schemas for all of your models!
---

When I (with help from .Net contributors) updated all of the libraries to support Native AOT, I wasn't able to fully implement schema generation.  The generation operated on some aspects of runtime reflection that Native AOT doesn't support.  The answer was compile-time source generation, but I didn't know how to do that.  Mostly, it was because I didn't know how Roslyn analyzers worked.

In this post, I'm not going to get too much into how the analyzer works.  To be honest, some of it is still a bit fuzzy.  I'm instead going to be talking about the journey to getting all of this working.

## The curse of AI

Yeah, a large part of the analyzer's primary workings were built using AI.  I figured there are enough examples of working analyzers online that I felt confident it had a pattern to follow.

Remember above when I said how some of how it works is still fuzzy.  Yeah, this is why.  I'm planning on jumping into that code to read through it and learn it more thoroughly, but I have to admit that it was a great help getting it going.  Most of the rest was done by me, though.  I still used AI to answer questions about the models and where I could find certain data.  I also used it a little for some of the more mundance and repetitive tasks as well as ensuring I had good test coverage.

However, this is what I call the curse of AI: it's a fantastic help to get stuff done (when it works), but you don't learn anything by using it.  Up to now, I've hand-written every line of code in this project.  As a result, I'm intimately familiar with the whole thing, some parts more than others.  Sometimes I still have to read through older code that I've written, but it's just a refresher; I'm not really relearning the code.

But when someone else writes the code, even AI, you can't get that level of understanding, so deep review and thorough testing of the code becomes essential.

Lately I find myself writing the code when I have the gumption to do it, but sometimes I just need to get something done, and I'm lazy.  I find that I usually end up getting frustrated with the AI because it's not doing a good job on something, so I'll backtrack and have it try again.  This happens repeatedly until I realize I could have probably saved time just doing it myself from the start.

## Getting into it

My first step was to simply do some exploration.  I wanted to identify possible options for how to do this.

1. The issue that inspired this update suggested generating strings that could then be saved to files and added to the assembly as resource strings.  A promising idea.
1. The AI suggested that we somehow use the library itself to generate the schemas, then do (1).  It turned out that this wasn't possible.

During the iteration, I realized that the generation could just create a static class using the `JsonSchemaBuilder` from the base library and its extension methods.  This provided the way forward, however it meant that all of the generation code would need to be rewritten.

Fortunately, I had already implemented it once, so the logic was the same; the difference was using the code analysis models instead of reflection models.

The base implementation went pretty smoothly.

## Supporting extensions

While using the builder extensions works well for built-in annotations, the reflective generation also supports custom annotations.  These annotations provide custom logic that add keywords (via keyword intents) to the builder.

I needed a way to support this in the source generation as well.  The solution I came up with was to have the attribute handler define a static `.Apply()` method that augmented a passed builder.  Then I just needed to generate a custom extension method that called that static method.

## Options and concessions

The last thing to consider was configurability.  There are two deciding factors here:

- What can be defined at compile-time?
- How does this interact with runtime configuration?

For the first, I could only include options that could be defined on the `[GenerateJsonSchema]` attribute.  So it now has optional parameters that you can set to configure property naming, property order, and whether conditionals produce strict property requirements.  I wouldn't be able to support custom generators or refiners, or set up a schema registry to support external references.

For the second, I had to concede that since the configuration needs to be available at compile time (when the schemas are generated), any runtime configuration just wouldn't be applicable.

## Wrapping up

Overall, I'm very excited about this release.  I need to go through the code so that I can properly support it, but it opens up a door to a more expansive future for this project.

_If you aren't generating revenue, you like the work I put out, and you would still like to support the project, please consider [becoming a sponsor](https://github.com/sponsors/gregsdennis)!_