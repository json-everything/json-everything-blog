---
title: "Learn json-everything"
date: 2024-06-10 09:00:00 +1200
tags: [learning]
toc: true
pin: false
---

JSON Schema is really a cool community to work in.  Over the past couple years, our Community Manager, [Benja Granados](https://github.com/benjagm), has had us involved in Google's Summer of Code program (GSoC), which gives (primarily) students an opportunity to hone their software development skills on real-world problems through contributions to open source.

This year, one of the GSoC projects JSON Schema is working on is a "[JSON Schema Tour](https://github.com/json-schema-org/community/issues/645)" website, which will provide a number of (very simple) coding challenges to the user as a way to teach the ins and outs of JSON Schema.  I was fortunate enough to be shown a preview of this new site a couple weeks ago, and it inspired me to do something similar for my libraries.

## Announcing _Learn `json-everything`_

[_Learn `json-everything`_](https://learn.json-everything.net) is a new site where you can learn how to use the various JSON technologies supported by the `json-everything` project.

In building the lessons for this site, I'm trying to focus more on using the libraries rather than on how to use the underlying technologies.  I don't want to step on the toes of the aforementioned GSoC project or other fantastic learning and reference material sites like [Learn JSON Schema](https://www.learnjsonschema.com/).

One exception to this is JSON Path.  Since RFC 9535 is relatively new, there's not a lot of documentation out there yet, so I'll be teaching the specification's particular flavor of JSON Path as well.

## A typical lesson

Currently a lesson consists of some background information, a link or two to relevant documentation, and a coding challenge.  The coding challenge is made up of a task to complete, a code snippet (into which the user's code will be inserted), and some tests to verify completion.

The background information typically describes the use case for a particular feature, and the coding challenge allows the user to get their hands dirty actually writing code.  In my experience, doing is the most effective way to learn.

As an example, here's the first lesson for JSON Schema, which teaches you how to deserialize a schema:

> ### Deserializing a Schema
> 
> #### Background
> 
> JSON Schema is typically itself represented in JSON.  To support this, the `JsonSchema`
> type is completely compatible with the _System.Text.Json_ serializer.
> 
> 
> [[Documentation](https://docs.json-everything.net/schema/basics/#schema-deserialization)] 
> 
> #### Task
> 
> Deserialize the text in `schemaText` into a `JsonSchema` variable called `schema`.
> 
> #### Code template
> 
> ```csharp
> using System.Text.Json;
> using System.Text.Json.Nodes;
> using Json.Schema;
> 
> namespace LearnJsonEverything;
> 
> public class Lesson : ILessonRunner<EvaluationResults>
> {
>     public EvaluationResults Run(JsonObject test)
>     {
>         var instance = test["instance"];
>         var schemaText =
>             """
>             {
>               "type": "object",
>               "properties": {
>                 "foo": { "type": "number", "minimum": 0 },
>                 "bar": { "type": "string" }
>               },
>               "required": ["foo", "bar"]
>             }
>             """;
> 
>         /* USER CODE */
> 
>         return schema.Evaluate(instance);
>     }
> }
> ```
> 
> #### Tests
> 
> |Instance|Is valid|
> |:-|:-|
> |`{"foo":13,"bar":"a string"}`|true|
> |`{"foo":false,"bar":"a string"}`|false|
> |`{"foo":13}`|false|
> |`{"bar":"a string"}`|false|
> |`[1,2,3]`|false|
> |`6.8`|false|

Then you're given a code editor in which you can provide code to replace the `/* USER CODE */` comment in the template.

The code in the lesson, along with the user's code, constructs an `ILessonRunner<T>` implementation.  Each lesson type (JSON Schema, JSON Path, etc.) defines what `T` is.  For JSON Schema, it's the evaluation results.  Then the implementation will be instantiated, `Run()` will be called for each of the tests, and the results will be compared with the expected outcomes from the tests.  The goal is to make all of the tests pass.

If compilation fails, the user will get the compiler output so that they can fix their code.

> Funnily, I discovered that adding `Console.WriteLine()` calls in the user code outputs to the browser console, so that can be used for debugging.
{: .prompt-tip }

## How it works

Like the main playground, _Learn `json-everything`_ is built with .Net's Blazor WASM.  Everything that the site does happens in the client, including building and running the C# code you enter.

The Blazor stuff is pretty straightforward.

> Well, as straightforward as web development can be.  I despise CSS layout.  I spent two days just trying to get the layout right, whereas the rest of the site infrastructure only took a couple hours!  Oh, how I long for the good ol' days of building UI/UX in WPF...
{: .prompt-info }

The really interesting part is how the code is built.  I figured out the majority of this when building support for schema generation on the playground, but I refined it a bit more with this site.

## Building and running C# inside a web browser

Blazor WASM does most of the heavy lifting by providing a way to run .Net in the browser _at all_, and a good portion of the rest is provided by the _Microsoft.CodeAnalysis.CSharp.Scripting_ Nuget package.  The rest involves building a context in which your compilation can run and then explicitly loading the new assembly.

Compilation requires two sources and several steps.  The sources are the source code (of course) and any referenced libraries.  The source code is pretty easy: it's provided by a combination of the code from the lesson and the user's code.  The referenced libraries are provided by whatever's in the current app domain along with the `json-everything` libraries.

### Getting references

In Blazor WASM, all of the libraries needed by a particular site can be found in a `/_framework` folder on the site root.  Also, by default, the libraries are trimmed, which means that parts of the libraries might have been removed to decrease load times.  While generally beneficial, it can be a problem when you're ad-hoc compiling your user's code.  I ended up just turning off trimming by adding `<PublishTrimmed>false</PublishTrimmed>` to my project file.

> As of .Net 8, the libraries are [published as _.wasm_ files](https://github.com/dotnet/runtime/issues/103071), not _.dll_ files, which the compiler doesn't understand.  To get the _.dll_ files, you'll need to add `<WasmEnableWebcil>false</WasmEnableWebcil>` to your project file.
{: .prompt-tip }

I also noticed that not all of the libraries you want to reference are loaded into the app domain right away, like the `json-everything` libraries themselves, because the site doesn't immediately make use of them.  The solution was to make sure that those specific libraries were loaded by simply searching for them explicitly by name.

Each library must be loaded as a `MetadataReference`, which means loading the file from a download stream.  All of this can be performed asynchronously, so I just kick it off as soon as the site loads.  I also put in protections so that if the user tries to run code before the assemblies are loaded, they get an error message to wait for the loading to finish.  I still need to look into a progress indicator so that the user can know when that's done.  For now, it's just listed in the browser console.

### Building code

The next step is actually building the code.

The first step is parsing the source into a syntax tree.  This is accomplished using the `CSharpSyntaxTree.ParseText()` method.  This doesn't need the references we just gathered; it's just looking at C# symbols and making sure the syntax itself is good.

You'll also need a temporary "file" for your assembly.  This is easy and doesn't require anything special.  Just use `Path.GetTempFileName()` and change the extension to _.dll_.

Next up, we create a compilation.  This takes the file name, the syntax tree, and the references and builds an actual compilation.  This is an intermediate representation of the build.

Finally, we use the compilation to emit IL and other build outputs.  The build outputs include the _.dll_ itself and optionally a _.pdb_ symbols file and/or an _.xml_ documentation file; you'll need to supply streams for these.  (I need all of them to support schema generation.)  This process will produce an `EmitResult` which contains any diagnostics (errors, warnings, etc.).

Once the IL is emitted into the assembly stream, it can be loaded via `AssemblyLoadContext.LoadFromStream()` and you can start using its types directly in your code.

> You'll probably want to unload the assembly when you're done with it.  Using an `AssemblyLoadContext` instead of `Assembly.Load()` allows this.  This site creates a new assembly with each compilation (every time the user clicks "Run"), so they stack up pretty quickly.  Unloading old contexts between each run helps keep memory usage down.
{: .prompt-warning }

All of the source for this is on [GitHub](https://github.com/gregsdennis/json-everything-learn/blob/main/LearnJsonEverything/Services/CompilationHelpers.cs).

## The hard part

With the above, I can build code provided by the user.  But honestly, for me, that was the easy part.

Now I have to do the hard part, which is building out lessons.  So far, the approach I've been taking is going through the documentation to identify things that could be enhanced with interactivity.  That's worked well so far, but I think I'm going to need more soon.

As I mentioned, I'll be teaching the RFC 9535 JSON Path, so that should keep me busy for a while.  And while I've done a few JSON Schema lessons, I still have the rest of the libraries to fill out as well.

I also have a slew of usability features I'd like to add in, like some level of intellisense, but I haven't figured out how just yet.

If you think of some lessons you'd like to see, or enhancements to the site, please feel free to open an issue or create a PR.

_If you like the work I put out, and would like to help ensure that I keep it up, please consider [becoming a sponsor](https://github.com/sponsors/gregsdennis)!_
