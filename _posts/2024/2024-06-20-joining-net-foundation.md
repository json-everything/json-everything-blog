---
title: "Joining the .Net Foundation"
date: 2024-06-10 09:00:00 +1200
tags: [.net, announcement]
toc: true
pin: false
---

That's right!  The `json-everything` project is officially a .Net Foundation member!

## How it started

### Inspiration from JSON Schema

A couple years ago JSON Schema started the onboarding process to join the OpenJS Foundation.  Joining a foundation in general means that they can lean on the experience of other members for help on things like governance, outreach, project organization, etc.  It helps to have the backing of a larger organization.

However, while the specification group would be joining the Foundation, all of the tooling built around the spec remained independent.

Sadly, the OpenJS Foundation onboarding journey was interrupted, so JSON Schema is still independent.  We'll likely try again, maybe with another foundation, but that's on the horizon for right now... and this post is about `json-everything` anyway!

### A push through JSON Path

As part of the JSON Path specification effort with IETF, I reached out to a lot of JSON Path implementations to let them know a specification was coming, and I kept my eyes open for other places where JSON Path was being used and/or requested.  One of those places was a [.Net issue](https://github.com/dotnet/runtime/issues/31068) requesting that _System.Text.Json_ get first-party support for the query syntax.  I posted about _JsonPath.Net_, and [one of the responses](https://github.com/dotnet/runtime/issues/31068#issuecomment-1992390964) intrigued me.

> That is awesome and for my personal stuff this is great, but professionally, I might be limited by corporate policy to use 1st party (Microsoft), or 2nd party (.net foundation membered), or "verified" 3rd party, (Newtonsoft), libraries. - [@frankhaugen](https://github.com/frankhaugen)

I had never considered that a professional wouldn't be able to use my libraries because of a corporate policy.

They go on to say that many of these policies are driven by "auditing agencies for things like SOC2 and ISO2700 -certifications."

As I created these libraries to help developers make great software, this barrier bothered me.

### Investigation

Looking into the three options mentioned, I first discovered that I'm not Microsoft.  (This was a devastating realization, and I had to re-evaluate my entire worldview.)  I'm also not a .Net Foundation member, but I could look into joining.  But first I wondered what it would take to have my packages verified on Nuget.

Verifying packages is pretty simple: you just need a signing certificate.   There are a [_lot_ of companies](https://www.google.com/search?q=signing+certificate) that provide them... and WOW are they expensive!

So, .Net Foundation seemed to be my best option.  I researched the [benefits](https://dotnetfoundation.org/membership/participation-types), the requirements, and the T&Cs.  (I'm looking for links to all of the pages I found before, but the site has changed, and it looks like the application process now starts by filling out a web form.  When I looked into it before, I just had to [open an issue](https://github.com/dotnet-foundation/projects/issues/new?assignees=sbwalker%2CChrisSfanos&labels=project+application%2Cproject+support&projects=&template=application.yml&title=Issue%3A+New+.NET+Foundation+Project+Application) on the .Net Foundation's Projects repo.  You should probably go through the web form if you want to join.)

### Application

They use a very extensive issue template that plainly lists all of their requirements.  Fortunately, through wanting to make my repository the best it could be, most of the requirements had already been met.

I had some questions about the IP implications of joining, and the Projects Committee was very helpful.  [Shaun Walker](https://github.com/sbwalker) answered these questions to my satisfaction, and [Chris Sfanos](https://github.com/ChrisSfanos) has been guiding the application through the rest of the process.

### Acceptance

The Projects Committee decides on projects to be inducted on what appears to be a monthly basis.  The result of their decision then goes to the .Net Foundation Board, who ultimately accepts or rejects the application.

I was quite pleased when I received notification that my humble `json-everything` had been accepted.

## How it's going

I'm currently still in the onboarding process.  There a [checklist](https://github.com/dotnet-foundation/projects/issues/367#issuecomment-2155296470) on my application issue that details all of the things that need to happen (or ensure have happened).

I think the biggest change is that the project will be under a [CLA](https://dotnetfoundation.org/docs/default-source/default-document-library/contribution-license-agreement.pdf).  I've read through it, and it basically says the contributor allows the project and .Net Foundation to distribute and potentially patent their contribution (as part of the project).  I'm not sure anything contributed to `json-everything` will or could be patented, but I suppose it's come up enough for them to add it to the CLA.  Outside of that, the contributor retains all rights.

I've also moved all of the related repos into a new `json-everything` org, and I spruced up the place a bit, made all the readmes pretty.  GitHub has done a good job of applying redirects, so everyone's links should still work.

Then there are some housekeeping things for the repo and public announcement stuff, which... I expect I should probably wait for that before publishing this...

## The future

<div class="video-container">
{% video /assets/video/star-trek-exciting.mp4 798 %}
<p class="video-caption">I like this ship! You know, it's exciting! - <strong>Star Trek, 2009</strong></p>
</div>

The future is bright for the project.  I expect to be working mostly on the new [learning site](/posts/learn-json-everything) by adding more lessons for _JsonSchema.Net_ and the other libraries.

I've been working hard over in JSON-Schema-Land getting the spec ready for its next release.  Keep an eye out on the [JSON Schema blog](https://json-schema.org/blog) for news about that.

And hopefully this means that more people can use my work!

_If you like the work I put out, and would like to help ensure that I keep it up, please consider [becoming a sponsor](https://github.com/sponsors/gregsdennis)!_
