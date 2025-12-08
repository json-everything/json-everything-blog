---
title: "Rebuilding JsonSchema.Net: The Journey"
date: 2025-12-08 09:00:00 +1200
tags: [.net, json-schema, architecture, performance]
toc: true
pin: false
---

_JsonSchema.Net_ has just undergone a major overhaul.  It's now faster, it uses less memory, it's easier to extend, and it's just more pleasant to work with.

This post discusses the motivations behind the change and the architectural concepts applied.  In the next post, I'll get into the technical bits.

## Two years ago

At the time I was still working on the JSON Schema specification full-time, and I had the first inklings of an idea for an implemention.  For the next few months, I couldn't shake the idea, but I also couldn't pin it down.

Finally after about a year of mental nagging, the idea was still elusive, but I had to figure it out.  Coding AI tools had started becoming kinda good, and I decided to spend some time just chatting in the abstract to work out the idea.

After a few days, and many, many threads of conversation, I landed on the idea of building a cyclical graph that was representative of the schema.  This graph would allow me to perform some degree of static analysis, which meant that I could complete certain tasks, like reference resolution, at build time instead of at evaluation time.

## Addressing a memory sink

Once the idea had shape, it was time to start looking at what an implementation could look like.  But first, I needed to assess what was causing the high memory usage in the current implementation.  After some testing I discovered that it was largely string allocations from JSON Pointer management.

So the first step was to rebuild _JsonPointer.Net_ using spans as the under-the-hood pointer representation.

Instead of using what boiled down to an array of strings for the pointer data representation, the new implementation uses a single `ReadOnlyMemory<char>`.  I also updated it to a struct, so if a new pointer is created and used within the scope of a method, there could be no allocation at all.  The parsing logic makes use of the array pool, and extracting subpointers just adjusts the span.

> I wanted to make it a `ref struct`, but that wouldn't have suited since I needed to be able to store it in a class, and `ref struct`s can only live on the stack.
{: .prompt-info }

The "downside" to this new implementation was that doing the work like evalutating a pointer or identifying individual segments happens on-the-fly.  But that's so much quicker than allocating memory that it's still a huge net gain in processing.

## Experimentation on schemas

With the new JSON Pointer implementation in place, I extracted it to a new project and started working with AI to build a new JSON Schema implementation that followed the research that I had compiled.

Over a few months, I'd go through this exercise several times.  With each iteration, a pattern emerged: the implementation showed lots of promise, being super-fast, then as complexity increased, that advantage disappeared.  Ultimately most of them either grew too slow or were just architectures or APIs I didn't care for.  But I saw a lot of different ways to solve the same problem, all of them even following the same approach: build a cyclical graph, pre-resolving anything that doesn't need an instance to evaluate, then perform repeated evaluations.

There is still one of them [on a branch](https://github.com/json-everything/json-everything/tree/schema/functional/src/JsonSchema/Experiments) if you want to see it.  This is the final state that I managed to get with AI writing the code.  The final commit on this was almost exactly a year ago.

In the intervening time between then and now, the desire to actually make the update stayed with me, but I was quite busy with my new job, and I just didn't have the time or energy to work on the library.  But it still burned in my mind.

Somewhere around this time, the computer I used for development decided to quit, and I could only use my gaming PC.  It was demoralizing to lose the computer.  I really liked it.  And it was distracting to use the computer that also had my games, all of which only made working on this project slower.

## Buckling down

Fast-forwarding to about six weeks ago, I had the mental space to work on the library again.  I excluded all of the keywords and other supporting files from the project so that I could add them back, one by one.

The approach I wanted to use was simple.

### Use `JsonElement` instead of `JsonNode`

In the first versions of _JsonSchema.Net_, I had used `JsonElement` because it was the only JSON DOM available.  When `JsonNode` was added, I decided to use that because it closely resembled the DOM I used in _Manatee.Json_, my previous library.

I later realized that `JsonNode` carried with it a lot of memory allocations, whereas `JsonElement` used spans to refer back to the original JSON string, eliminating allocations.  The first and probably simplest improvement is moving to `JsonElement`.

### Keyword handlers instead of instances

One of the things that the AI would repeatedly implement through the experimentation was static keyword handers.  Stateless logic machines that would be called on the raw data.

That means that the keywords don't need to be deserialized.  But that also means that validation of the keyword data needed to be handled differently.

The new keywords need three functions: validate keyword data, build subschemas, and perform instance evaluation.  I also didn't want static handlers because I wanted instances of them in collections.  Singletons provide that function nicely.

### Separate build from evaluation

This was really the crux of the idea I had so long ago.  A single build that performed most of the computation ahead of time in order to make the evaluation quick and easy.

The current code actually does this to a degree.  It saves as much info as possible between evaluations, but if you tried to evaluate it with a different set of options, say with a different specification version or a different schema registry, then it couldn't assume that the current build was valid, and it had to rebuild from the start again.

The solution here was two-fold: save the build options (or at least what was needed for evaluation later) with the schema, and make the schema immutable.

### Allow multiple build configurations

I had multiple GitHub issues opened that centered around the fact that adding a keyword made it available for every schema.  I also thought the vocabulary implementation was clunky.  What was needed was a way to have a keyword supported for one schema build and unsupported for another.  That just isn't possible with the current approach.

So we need registries for everything, a configuration that specified everything needed to build a schema, and nothing is static.

## Settling in

With these ideas in mind, I loaded up the solution and got to work.

> While I used AI to help with working out the ideas and with some experimental implementations, the final output was coded by hand.  It feels a bit odd to say that, though, as if I'm advertising that _this_ code is hand-crafted... with love... for you.
{: .prompt-info }

First thing I did was to remove stuff I didn't need.  Instead of deleting files, I excluded them from the project file.  This allowed me to slowly add stuff back as I was ready to work on it, and it also gave me an insurance policy against forgetting anything.

I got the `IKeywordHandler` interface in place, re-added the `type` keyword as a sample, and implemented the new interface.  This was enough for me to tear down the evaluation logic in `JsonSchema` and see what else I needed.

After a few hours of work, my computer promptly decided to quit.  So now I don't have any computer to work on.  I hadn't even committed my work.  I was bummed.  Fortunately, the hard drive seemed fine, and I was able to do some hackery and get the files onto a network backup, but I wouldn't get a computer I could work on for another three weeks.

When I finally did get back in action, I was full throttle.  Three weeks of late nights and full weekends later, the implementation is done, including all of the extension libraries (except data generation), and passing all of the tests.  Over the past couple days, I've completed the updates to the docs.

## Finishing up

It's been a long journey, and I'm so happy with the library now.  Before this update, I was discouraged about making changes and fixing bugs.  I just didn't enjoy working in the code.  Now the code is simple to understand and edit, and it's not because I just finished writing it; it's legitimately simpler.  And to boot, it's faster!

_If you like the work I put out, and would like to help ensure that I keep it up, please consider [becoming a sponsor](https://github.com/sponsors/gregsdennis)!_
