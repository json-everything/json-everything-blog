---
title: "In Pursuit of Native Code"
date: 2024-02-01 09:00:00 +1200
tags: [.net, system.text.json, native-aot, serialization]
toc: true
pin: false
---

I don't even know how to begin this post.  I don't think there has been as big an announcement for this project as support for .Net 8 and Native AOT.  Yet here we are.

***HUGE*** thanks to [Jevan Saks](https://github.com/jevansaks) for the help on this.  This update wouldn't be possible without him.  Saying he coded half of the update would be underselling his contributions!  More than code, though, he helped me better understand what all of this AOT stuff is and the APIs that make it work.

Additional thanks to [Eirik Tsarpalis](https://github.com/eiriktsarpalis), who basically **is** _System.Text.Json_ right now, for helping shed light on intended patterns with JSON serializer contexts.

## What is Native AOT?

[Native AOT](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/), or _Ahead of Time_ compilation, is a way to make .Net applications run anywhere using native code, which means they don't need the runtime to operate.

What that means for developers who want to _make_ native apps is generally avoiding dynamically generated code, so mostly no JIT (just-in-time compilation) or reflection that involves generics.  You can start to imagine how limiting that can be.  It makes things especially difficult for operations like serialization, which traditionally relies heavily on reflection.

However, the _System.Text.Json_ team is pretty smart.  They've figured out that they can use source generation to inspect any code that might be serialized and generate code that stores the type information, all at compile time.  But they can't do that without your help.

First, you have to mark your project as AOT-compatible (the source generation stuff can be done outside of AOT).  Then you have to set up a serializer context and annotate it with attributes for every type that you expect to serialize.  (This is the trigger for the source generation.)  Lastly, any usage of a method which uses unsupported reflection will generate a compiler warning, and then you have some attributes that you can use to either pass the warning on to your callers or indicate that you understand the risk.

Of course there's a lot more to understand, and I don't claim that I do.  So go read the .Net docs or a blog post that focuses more on the power of Native AOT to learn more.

## Why support .Net 8 explicitly?

My understanding was that there were a lot of features in .Net 8 that I didn't have access to when building only to .Net Standard 2.0.  Primarily, the compiler only gives the AOT warnings when building for .Net 8.  Since that was the goal, it made sense to include the target explicitly.

What was unclear to me was that the majority of the features that I wanted to use were actually available through either later versions of the _System.Text.Json_ Nuget package or through [Sergio Pedri
](https://github.com/Sergio0694)'s amazing [PolySharp](https://github.com/Sergio0694/PolySharp) package.

> I had at some point tried to update to _System.Text.Json_ v7, but I found that a good portion of the tests started failing.  I didn't want to deal with it at the time, so I put it off.
{: .prompt-info}

## Why now?

I've had a [long-standing issue](https://github.com/gregsdennis/json-everything/issues/390) open on GitHub where I considered the possibility of dropping .Net Standard support and moving on to just supporting one of the more modern .Net versions.  In that issue, I floated the idea of updating to .Net 6.

While that issue languished for almost a year, I had users approach me about supporting features that were only available in later versions of frameworks, which meant that I'd have to multi-target.

I've multi-targeted in libraries before, and I've seen in other libraries the code-reading nightmare that can result from a bunch of compiler directives trying to isolate features that were only available in different .Net versions.  Trying to read through all of that to parse out what's actually compiling under a given framework target can be tough.

The springboard for this effort really came from Jevan's jumping into the deep end and starting the update by creating a PR.  This was the kick in the pants I needed.

## How did the update go?

When we started working on this update, the first thing we did was multi-target with .Net 8 in all of the libraries; the tests already targeted .Net Core 3.1 and .Net 6, so we added .Net 8 and called it good.

> We ended up having to drop support for .Net Core 3.1 due to an incompatibility in one of _System.Text.Json_'s dependencies.  However the framework is out of support now, so we figured it was okay to leave it behind.
{: .prompt-warning}

I set up a [feature branch PR](https://github.com/gregsdennis/json-everything/pull/619) with a checklist of things that needed to be done, and we started creating satellite PRs to merge in.

We started updating all of the package references and addressing the immediate warnings that came with the updated framework target (mostly null analysis and the like).  In order to avoid collisions in our work, we coordinated our efforts in Slack.  There were a few times one of us would need to rebase, but overall it went really well.

Then we added `<IsAotCompatible>` properties to all of the library project files, which gave us our first round of AOT warnings to address.

We went through almost 40 PRs between Jevan and me, incrementally updating toward a final state.  There was a lot of experimentation and discussion over patterns, and I learned a lot about the AOT APIs as well as finding some solutions to a few pitfalls.  I can't tell you how many approaches and workarounds we added only for them to ultimately be removed in favor of something else.  But it was part of the learning process, and I don't know that we could have reached the final solution without going through the alternatives.

It wasn't all adding code, though.  Some of the functionality, like the `JsonNode.Copy()` extension method wasn't needed anymore because the updated _System.Text.Json_ provides a `.DeepClone()` that does the same job.

By the end of it we were left with just about everything supporting Native AOT.  And, mostly thanks to PolySharp, we didn't need to litter the code with compiler directives.  (I was even able to remove the dependency on _Jetbrains.Annotations_!)  The only project that explicitly doesn't work in an AOT context is the schema generation, which requires high levels of reflection to operate.  (But really, I consider that to be more for development tools rather than a production library; it's supposed to give you a start.)

## Is there anything to watch out for when updating to the new packages?

I've bumped the major version on all of the libraries.  For many of the libraries, that's due to .Net Standard 3.1 no longer being supported.

Aside from that, it's small things like removing the `JsonNode.Copy()` extension method I mentioned earlier and removal of obsolete code.  I've detailed all of the changes for each library in the release notes, which you can find in the [docs](https://docs.json-everything.net/).

I think most notably is that if you're not building an AOT-compliant app, you probably won't need to update much, if anything at all.

## What's next?

The updated libraries are all available now, so the only thing that's left for this particular update is updating the docs, which I'll be working on for the next few weeks probably.

As always, if you have any problems with anything, please feel free to drop into Slack or open an issue in GitHub.  Until then, enjoy the update!
