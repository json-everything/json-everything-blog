---
title: "Revamping the JsonSchema.Net Build Chain"
date: 2024-10-26 09:00:00 +1200
tags: [.net, github-actions, build, ci-cd, learning]
toc: true
pin: false
---

Last week I discovered that my pack and publish builds for _JsonSchema.Net_ and its language packs were failing.  Turns out _nuget.exe_ isn't supported in Ubuntu Linux anymore.  In this post I'm going to describe the solution I found.

## The build that was

Rewind two and a half years.  I've added the `ErrorMessages` class to _JsonSchema.Net_ and I want to be able to support multiple languages on-demand, the way [Humanizr](https://github.com/Humanizr/Humanizer) does: a base package that supports English, and satellite language packs.  (They also publish a meta-package that pulls all of the languages, but I didn't want to do that.)

So the first thing to do was check out how they were managing their build process.  After some investigation, it seemed they were using `nuget pack` along with a series of custom _.nuspec_ files.  The big change for me was that they weren't using the built-in "pack on build" feature of `dotnet`, which is what I was using.

So I worked it up.  The final solution had three parts:

- Build the library
- Pack and push _JsonSchema.Net_
- Pack and push the language packs

The first two steps were pretty straighforward.  The language packs step utilized a [GitHub Actions matrix](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/running-variations-of-jobs-in-a-workflow) that I built by scanning the file system for _.nuspec_ files during the build step.  And to run the pack and push, I used _nuget.exe_ which was provided by the [`nuget/setup-nuget`](https://github.com/NuGet/setup-nuget) action.

Everything was great.

Until it wasn't.

## Sadness ensues

As I mentioned, last week I discovered that the workflow was failing, so I went to investigate.  Turns out the failing action was `nuget/setup-nuget`: simply installing the Nuget CLI.

After some investigation, I found that [the Nuget CLI requires Mono](https://github.com/NuGet/setup-nuget/issues/168#issuecomment-2573539599), and Mono is now out of support.  I never had to install Mono, so either it was pre-installed on the Ubuntu image or the Nuget setup action installed it as a pre-requisite.  Probably the latter.  And now, since Mono is no longer supported, they don't do that anymore.  Whatever the reason, the action wasn't working, so I couldn't use the Nuget CLI.

That means I need to figure out how to use the `dotnet` CLI to build a custom Nuget package.  But there's a problem with that: `dotnet pack` doesn't support _.nuspec_ files; it only works on project files, like _.csproj_.

The help I needed came from [Glenn Watson](https://github.com/glennawatson) from the .Net Foundation.  I happened to comment about the build not working and he was able to point me to another project that built custom Nuget packages with `dotnet pack` and the the project file.

After about four hours of playing with it, I finally landed on something that worked enough.  It's not perfect, but it does the job.

## Building the base package

To start, I just wanted to see if I could get the main package built.  Then I'd move on to the language packs.

I learned from the other project that to build a custom Nuget package, I need to do two things:

- Prevent the packing step from using the build output by using
  ```xml
  <IncludeBuildOutput>false</IncludeBuildOutput>
  ```
- Create an `ItemGroup` with a bunch of entries to indicate the files that need to go into the package.
  ```xml
  <None Include="README.md" Pack="true" PackagePath="\" />
  ```

Doing it this way does mean that you have to explicitly list every file that is supposed to be in the package.  This is basically the same as using _nuget.exe_ with a _.nuspec_ file, so I really already had the list of files I needed, just in a different format.

This new `ItemGroup` had a side effect, though.  I could see all of these files in my project in Visual Studio.  To fix this, I put a condition on the `ItemGroup` that defaults to false.

```xml
<ItemGroup Condition="'$(ResourceLanguage)' == 'base'">
```

This condition means the `ItemGroup` only applies when the `ResourceLanguage` property equals `base`, which we'll use to indicate the main library.  What's the `ResourceLanguage` property?  I made it up.  Apparently you can just make up properties and then define them on various `dotnet` commands:

```sh
dotnet pack -p:ResourceLanguage=base
```

> The property's default value is nothing, which gives an empty string... and an empty string doesn't equal `base`, so we've successfully hidden the package files while still having access to them during the packing process.
{: prompt-hint }

The new section now looks like this:

```xml
<ItemGroup Condition="'$(ResourceLanguage)' == 'base'">
  <None Include="README.md" Pack="true" PackagePath="\" />
  <None Include="..\..\LICENSE" Pack="true" PackagePath="\" />
  <None Include="..\..\Resources\json-logo-256.png"
        Pack="true" PackagePath="\" />
  <None Include="bin\$(Configuration)\netstandard2.0\JsonSchema.Net.dll"
        Pack="true" PackagePath="lib\netstandard2.0" />
  <None Include="bin\$(Configuration)\netstandard2.0\JsonSchema.Net.xml"
        Pack="true" PackagePath="lib\netstandard2.0" />
  <None Include="bin\$(Configuration)\netstandard2.0\JsonSchema.Net.pdb"
        Pack="true" PackagePath="lib\netstandard2.0" />
  <None Include="bin\$(Configuration)\net8.0\JsonSchema.Net.dll"
        Pack="true" PackagePath="lib\net8.0" />
  <None Include="bin\$(Configuration)\net8.0\JsonSchema.Net.xml"
        Pack="true" PackagePath="lib\net8.0" />
  <None Include="bin\$(Configuration)\net8.0\JsonSchema.Net.pdb"
        Pack="true" PackagePath="lib\net8.0" />
  <None Include="bin\$(Configuration)\net9.0\JsonSchema.Net.dll"
        Pack="true" PackagePath="lib\net9.0" />
  <None Include="bin\$(Configuration)\net9.0\JsonSchema.Net.xml"
        Pack="true" PackagePath="lib\net9.0" />
  <None Include="bin\$(Configuration)\net9.0\JsonSchema.Net.pdb"
        Pack="true" PackagePath="lib\net9.0" />
</ItemGroup>
```

Using the command line (because that's what's going to run in the GitHub workflow), I built the project and ran the pack command.  Sure enough, I got a Nuget package that was properly versioned and contained all of the right files!

Step 1 complete.

## Building language packs

The language pack Nuget files carry different package names, versions, and descriptions.  In order to support this, we need to isolate the properties for the base package by defining a `PropertyGroup` for the base package that also has the condition from before so that those properties don't get mixed into the language packs.

```xml
<PropertyGroup Condition="'$(ResourceLanguage)' == 'base'">
  <IncludeSymbols>true</IncludeSymbols>
  <SymbolPackageFormat>snupkg</SymbolPackageFormat>
  <PackageId>JsonSchema.Net</PackageId>
  <Description>JSON Schema built on the System.Text.Json namespace</Description>
  <Version>7.3.2</Version>
  <PackageTags>json-schema validation schema json</PackageTags>
  <EmbedUntrackedSources>true</EmbedUntrackedSources>
</PropertyGroup>
```

Now we can define an additional `PropertyGroup` and `ItemGroup` for when `ResourceLanguage` isn't nothing (remember, nothing is for Visual Studio and the code build) and isn't `base` (for the base package).

```xml
<PropertyGroup Condition="'$(ResourceLanguage)' != '' And '$(ResourceLanguage)' != 'base'">
  <PackageId>JsonSchema.Net.$(ResourceLanguage)</PackageId>
  <PackageTags>json-schema validation schema json error language-pack</PackageTags>
</PropertyGroup>

<ItemGroup Condition="'$(ResourceLanguage)' != '' And '$(ResourceLanguage)' != 'base'">
  <None Include="Localization\README.$(ResourceLanguage).md"
        Pack="true" PackagePath="\README.md" />
  <None Include="..\..\LICENSE" Pack="true" PackagePath="\" />
  <None Include="..\..\Resources\json-logo-256.png"
        Pack="true" PackagePath="\" />
  <None Include="bin\$(Configuration)\netstandard2.0\$(ResourceLanguage)\JsonSchema.Net.resources.dll"
        Pack="true" PackagePath="lib\netstandard2.0\$(ResourceLanguage)" />
  <None Include="bin\$(Configuration)\net8.0\$(ResourceLanguage)\JsonSchema.Net.resources.dll"
        Pack="true" PackagePath="lib\net8.0\$(ResourceLanguage)" />
  <None Include="bin\$(Configuration)\net9.0\$(ResourceLanguage)\JsonSchema.Net.resources.dll"
        Pack="true" PackagePath="lib\net9.0\$(ResourceLanguage)" />
</ItemGroup>
```

> Also notice that I've also incorporated the `ResourceLanguage` property to identify the correct paths.
{: .prompt-info}

And finally, I used an additional `PropertyGroup` for each language I support so that they can each get their own description and version:

```xml
<PropertyGroup Condition="'$(ResourceLanguage)' == 'de'">
  <Description>JsonSchema.Net Locale German (de)</Description>
  <Version>1.0.1</Version>
</PropertyGroup>
```

Now I can run a similar `dotnet` command for each of the languages I support:

```sh
dotnet pack -p:ResourceLanguage=de
```

## Updating the workflow

The final thing I needed to update was the GH Actions workflow.

I still like the idea of using the matrix, but now I don't have the nuspec files I used previously to generate the list of languages.  But I do know all of the languages I support, and that list doesn't update much, so I can just list it explicitly in the workflow file and update as needed.

Also, I found that including `base` as one of the options also packs the base library, so I don't need a separate job for it, which is nice.

Now I just have a single matrixed job that runs for `base` and all of the languages.  (Link to the workflow at the end of the post.)

## That's good enough

The only thing I wasn't able to figure out is the dependencies for the language packs.  They're currently the dependencies of the main lib.  I tried putting the condition on the `ItemGroup`s with the project and package references, but it didn't have any effect on the pack command.  Because of this and a feedback I got while trial-and-erroring this, I suspect it detects the dependencies from the `obj/` folder rather than from the _.csproj_ file.

You can view the final project file [here](https://github.com/json-everything/json-everything/blob/28090a609bcc39bbd77c3c28501b522dea600d34/src/JsonSchema/JsonSchema.csproj) and the GH Actions workflow file [here](https://github.com/json-everything/json-everything/blob/28090a609bcc39bbd77c3c28501b522dea600d34/.github/workflows/publish-schema.yml).

I've also opened an issue on Humanizr to let them know of the solution I found in case they encounter the same problem.

_If you like the work I put out, and would like to help ensure that I keep it up, please consider [becoming a sponsor](https://github.com/sponsors/gregsdennis)!_
