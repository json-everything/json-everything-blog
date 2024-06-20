---
title: "Improving JsonSchema.Net (Part 2)"
date: 2024-05-17 09:00:00 +1200
tags: [json-schema, architecture, performance, learning]
toc: true
pin: false
---

Over the last few posts, I've gone over some recent changes to my libraries that work toward better performance by way of reducing memory allocations.

In this post, I'd like to review some changes I made internally to _JsonSchema.Net_ that helped the code make more sense while also providing some of the performance increase.

## The sad state of things

In version 6 and prior, analysis of schemas was performed and stored in code that was strewn about in many different places.

- `JsonSchema` would assess and store a lot of its own data, like base URI, dialect, and anchors.
- There were extension methods for various lookups that I had to do a lot, and the static class that defined the methods had private static dictionaries to cache the data.
  - Keyword `Type` and instance to keyword name (e.g. `TitleKeyword` -> "title")
  - Whether a keyword supported a given JSON Schema version (e.g. `prefixItems` is only 2020-12)
  - Keyword priority calculation and lookup (e.g. `properties` needs to run before `additionalProperties`)
  - Whether a keyword produced annotations that another keyword needed (e.g. `unevaluatedProperties` depends on annotations from `properties`, even nested ones)
- The code to determine which keywords to evaluate was in `EvaluationOptions`.
- But the code to determine which keywords were supported by the schema's declared meta-schema was in `EvaluationContext`.

Yeah, a lot of code in places it didn't need to be.  Moreover, a lot of this was performed at evaluation time.

It was time to fix this.

## A better way

About a month ago, I ran through an experiment to see if I could make a JSON Schema library (from scratch) that didn't have an object model.  This came out of [reworking my JSON Logic library](/posts/logic-without-models) to do the same.

> The results of this experiment can be found in the [`schema/experiment-modelless-schema`](https://github.com/gregsdennis/json-everything/tree/schema/experiment-modelless-schema) branch, if you want to have a look.  There's a new static `JsonSchema.Evaluate()` method that calls each keyword via a new `IKeywordHandler` interface.  While the single run performance is great, it can't compete at scale with the [static analysis](/posts/new-json-schema-net) that was introduced a few versions ago.
{: .prompt-info }

In building the experiment, I had to rebuild things like the schema and keyword registries, and I discovered that I could do a lot of the analysis that yielded the above information at registration time.  This meant that I wasn't trying to get this data during evaluation, which is what lead to the stark increase in performance for single evaluations.

I had decided not to pursue the experiment further, but I had learned a lot by doing it, so it wasn't a waste.

> Sometimes rebuilding something from scratch can give you better results, even if it just teaches you things.
{: .prompt-tip }

So let's get refactoring!

<div class="video-container">
{% video /assets/video/matrix-we-got-a-lot-to-do.mp4 798 %}
<p class="video-caption">We got a lot to do. We gotta get to it. - <strong>The Matrix, 1999</strong></p>
</div>

## Managing keyword data

I started with the keyword registry.  I wanted to get rid of all of those extensions and just precalculate everything as keywords were registered.

In its current state, `SchemaKeywordRegistry` contained three different dictionaries:

- keyword name → keyword type
- keyword type → instance (for keywords that need to support null values, like `const`; this resolves some serializer problems)
- keyword type → keyword `TypeInfoResolver` (supports Native AOT)

In the keyword extensions, I then had more dictionaries:

- keyword type → keyword name (reverse of what's in the registry)
- keyword type → evaluation group (supporting priority and keyword evaluation order)
- keyword type → specification versions

That's a lot of dictionaries!  And I needed them all to be concurrent!

### Consolidation

First, I need to consolidate all of this into a "keyword meta-data" type.  This is what I came up with:

```c#
class KeywordMetaData
{
    public string Name { get; }
    public Type Type { get; }
    public long Priority { get; set; }
    public bool ProducesDependentAnnotations { get; set; }
    public IJsonSchemaKeyword? NullValue { get; set; }
    public SpecVersion SupportedVersions { get; set; } 
    public JsonSerializerContext? SerializerContext { get; }

    // constructor contains most of the keyword inspection as well.
}
```

This single type stores all of the information for a single keyword that was stored in the various dictionaries listed above.

### Access

Second, I need a way to store these so that I can access them in multiple ways.  What I'd really like is a current dictionary that allows access to items using multiple keys.  There are probably (definitely) a number of ways to do this.

My [approach](https://github.com/gregsdennis/json-everything/blob/master/src/JsonSchema/MultiLookupConcurrentDictionary.cs) was to wrap a `ConcurrentDictionary<object, KeywordMetaData>` and keep a collection of "key functions" that would produce a number of key objects for an item.  When I add an item, it produces all of the keys and creates an entry for each, using the item as the value.  That way, I can look up the item using any of the keys.

### Data initialization

With these pieces in place, I can simply take all of the keyword types, build meta-data objects, and add those to the lookup.

Finally, once the lookup has all of the keywords, I run some dependency analysis logic to calculate the priorities, and it's done.

When a client adds a new keyword, I simply add it to the lookup and run the dependency analysis again.

### Deletion

The final step for this part of the refactor was to move the extension methods into the `SchemaKeywordRegistry` class (which was already static anyway) and delete the `KeywordExtensions` class.

## Managing schema data

The other significant update I wanted to make was how schema data was handled.  Like keywords, the data should be gathered at registration time rather than at evaluation time.

So what kind of data do I need (or can I get) from schemas?

- What is the root document for any given URI?
- Are there any anchors defined in the document?
- Are any of those anchors dynamic (defined by `$dynamicAnchor`)?
- Are any of those anchors legacy (defined by `$id` instead of `$anchor`)?
- Is there a `$recursiveAnchor`?
- What version of the specification should it use?
- What dialect does the schema use (which keywords does its meta-schema declare)?

I currently have several chunks of code in various places that calculate and store this.  Like the keyword data, this could be consolidated.

### Consolidation

In previous versions, `JsonSchema` contained a method called `PopulateBaseUris()` that would run on the first evaluation.  This method would recursively scan the entire tree and set all of the base URIs for all of the subschemas and register any anchors.  The anchor registry was on `JsonSchema` itself.

Later, when resolving a reference that had an anchor on it, the `RefKeyword` (or `DynamicRefKeyword` or whatever needed to resolve the reference) would ask the schema registry for the schema using the base URI, and then it would check that schema directly to see if it had the required anchor.

A better way would be to just let the registry figure it all out.  To do that, we need a registration type to hold all of the schema identifier meta-data.

```c#
class Registration
{
    public required IBaseDocument Root { get; init; }
    public Dictionary<string, JsonSchema>? Anchors { get; set; }
    public Dictionary<string, JsonSchema>? LegacyAnchors { get; set; }
    public Dictionary<string, JsonSchema>? DynamicAnchors { get; set; }
    public JsonSchema? RecursiveAnchor { get; set; }
}
```

### Access

The next step was to expose all of this glorious data to consumers of the registry.

I already had a `.Get(Uri)` method, but for this, I'd need something a bit more robust.  So I created these:

- `.Get(Uri baseUri, string? anchor, bool allowLegacy = false)`
- `.Get(DynamicScope scope, Uri baseUri, string anchor, bool requireLocalAnchor)`
- `.GetRecursive(DynamicScope scope)`

> These are all internal, but the `.Get(Uri)` still exists publicly.
{: .prompt-info }

These methods let me query for schemas identified by URIs, URIs with anchors, and recursive and dynamic anchors, all with varied support based on which specification version I'm using.

- Draft 6/7 defines anchors in `$id`, but that usage is disallowed since 2019-09, which added `$anchor`.
- Draft 2019-09 defines `$recursiveAnchor`, but that was replaced by `$dynamicAnchor` in 2020-12.
- In draft 2020-12, `$dynamicRef` has a requirement that a `$dynamicAnchor` must exist within the same schema resource.  This has been removed for the upcoming specification version.

I have to support all of these variances, and I can do that with these three methods.

### Data initialization

Scanning the schemas seemed like it was going to be the hard part, but it turned out to be pretty easy.

As mentioned before, the old scanning approach was recursive: it would scan the local subschema to see if it had the appropriate keywords, then it would call itself on any nested subschemas to scan them.

However, during all of the changes described in this and the previous posts, I developed a pattern that lets me scan a recursive structure iteratively.  I'm not sure if it's the _best_ way, but it's a good way and it's mine.  Here's some pseudocode.

```c#
Result[] Scan(Item root)
{
    var itemsToScan = new Queue() { root };
    var result = new List();
    while (itemsToScan.Count != 0)
    {
        // get the next item
        var item = itemsToScan.Dequeue();

        // gather the data we want from it
        var localResult = GetDataForLocal(item);
        result.Add(localResult);

        // check to see if it has children
        foreach(var sub in item.GetSubItems())
        {
            // set up child for scan
            itemsToScan.Enqueue(sub);
        }
    }

    return result;
}   
```

The things I wanted to get at each stage were all the anchors from before.

_And_ since I was already iterating through all of the subschemas and tracking their base URIs, it was simple to just set that on the subschemas.  I also checked for:

- a declared version, determined by the meta-schema, which I could get because I'm already in the schema registry
- the dialect, which is the set of vocabularies (which declare support for keywords) defined by that meta-schema

### Deletion

With all of this now pre-calculated when the schema is registered, I no longer needed all of the code that did this spread out all over everywhere.  So it's gone!

- `JsonSchema` no longer keeps anchor data
- `EvaluationOptions` no longer determines which keywords to process
- `EvaluationContext` no longer determines vocab or stores dialect information

(This seems like a short list, but it was a serious chunk of code.)

## Wrap up

This was a lot of refactoring, but I've been wanting to do something about the disorganized state of my code for a really long time.

I knew that it needed fixing, and I unexpectedly discovered how to fix it by writing a new implementation from scratch.  Hopefully that won't be necessary every time.

Thanks for reading through this series of posts covering the latest set of improvements and the things I learned along the way.

## One last thing

I've recently set up my [GitHub Sponsors page](https://github.com/sponsors/gregsdennis), so if you or your company find my work useful, I'd be eternally grateful if you signed up for a monthly contribution.

When you sign up at any level, you'll be listed in the sponsors section on that page as well as the new [Support page](/support) on this blog.  Higher levels can get social media shoutouts as well as inclusion in the sponsors bubble cloud at the bottom of the [json-everything.net](https://json-everything.net) landing page (which will show up as soon as I have such a sponsor).

Thanks again.

_If you like the work I put out, and would like to help ensure that I keep it up, please consider [becoming a sponsor](https://github.com/sponsors/gregsdennis)!_
