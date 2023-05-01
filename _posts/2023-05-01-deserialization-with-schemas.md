---
title: "JSON Deserialization with JSON Schema Validation"
date: 2023-05-01 09:00:00 +1200
tags: [json-schema, deserialization]
toc: true
pin: false
---
This past weekend, I wondered if it was possible to validate JSON as it was being deserialized.  For _streaming_ deserialization, this is very difficult, if not impossible.  It's certainly not something that a validator like _JsonSchema.Net_ is set up to do.  But I found another option.

In this post, I'm going to go over the new v4.1.0 release of _JsonSchema.Net_, which includes support for full JSON Schema validation _during_ deserialization, and why this approach is preferred over the built-in validation options.

## What options have we?

Let's start by looking at what we have available to us for model validation.

For this post, I'm going to use the following model:

```c#
public class MyModel
{
    public string Foo { get; set; }
    public int Bar { get; set; }
    public DateTime Baz { get; set; }
}
```

The serializer is pretty simple.  It'll check basic things like value type, and that's pretty much it.  In some cases, it can do a little better; for example, in cases like `Baz` where the serialization results in a string, it will verify that the string content is representative of the type it's supposed to deserialize to, but this is really just an extension of the type checking.

For anything more robust, we need to add attributes from `System.ComponentModel.DataAnnotations`.  These annotations allow us to specify data validity for our properties.

Let's add the following requirements:

- `Foo` must be between 10 and 50 characters long
- `Bar` cannot be negative
- `Baz` is required

```c#
public class MyModel
{
    [MinLength(10)]
    [MaxLength(50)]
    public string Foo { get; set; }
    [Range(0, int.MaxValue)]
    public int Bar { get; set; }
    [Required]
    public DateTime Baz { get; set; }
}
```

But we have a problem.  The serializer doesn't support these attributes at all.  This JSON will still be deserialized successfully:

```json
{
  "Foo": "foo",
  "Bar": -42
}
```

Ideally, we want to get errors for all three of these properties, but the serializer gives us nothing.  Instead, we get a model with

- `Foo` is the string `"foo"`
- `Bar` is -42
- `Baz` is `DateTime.MinValue` (the default for `DateTime`)

We have to separately check the model after it's been deserialized to determine if what we received is valid.

```c#
results = new List<ValidationResult>();    
Validator.TryValidateObject(myModel, new ValidationContext(myModel), results, true);
```

This will populate `results` with the errors that it can detect.  But because `Baz` is not nullable in our model, it receives the default value for its type, and thus the `[Required]` attribute is met, even though it was missing from the JSON data.

While this system can work, it has its shortcomings.

- We can receive errors from either the serializer via exceptions or from the model validator via the list.
- The serializer is only going to report the first error is receives.  There may be others.

## Validation during deserialization

In order to make a better experience, we want to validate the JSON as it's coming in.  To do that, we need a couple things:

- a way to attach a schema to a type
- a way to hook into the serializer

For the first one, we'll create a `[JsonSchema()]` attribute that can be applied to a type.  This is easy; we'll come back to it later.  The second one is harder, so let's tackle that first.

The only way to do hook into the serialization process is with a JSON converter.

Well... kinda.  There is a more roundabout way, called a JSON converter factory.  Basically, this is a special `JsonConverter`-derived class that produces other `JsonConverter` instances that are then used to perform the conversion.

The idea now is to create a converter that performs validation then passes off deserialization to another converter, specifically the one the serializer would have chosen without our validation converter.

![flow chart](/assets/img/2023-05-01-deserialization-with-schemas-flow.png)
_made with [yEd](https://www.yworks.com/yed-live/)_

1. The serializer checks any custom converters to see if they can handle our type.
2. `ValidatingJsonConverter` (this is actually our factory) checks the type for the `[JsonSchema()]` attribute.  If it is found, it returns a `ValidatingJsonConverter<T>` (`T` is the type to convert); otherwise it says it can't convert that type.
3. The serializer invokes the converter.
4. The converter reads the JSON payload and validates it against the schema.  If the JSON isn't valid, it throws a `JsonException` with the details of the validation; otherwise, it passes deserialization to another converter.

The factory turns out to be pretty easy.  We need to create a converter that's typed for what we're trying to deserialize.  A little reflection, and we're done.

The interesting challenge is in the converter itself, and it uses a rather neat consequence of .Net's decision to make `Utf8JsonReader` a struct.

## The converter

Historically when I've tried to validate JSON before deserialization, I would first parse the JSON into `JsonNode` (or `JsonElement` before that was available).  Then I could validate it with a schema.  If the validation succeeded, I could then deserialize directly from the JSON model.

However this secondary deserialization actually meant that it was getting the string representation back out of the JSON model and then [parsing it again](https://github.com/dotnet/runtime/issues/84234) in the deserialization step.  As quick as the `System.Text.Json` serializer is, making it perform a complete parse twice can get expensive.

To avoid (some of) this duplication of work, it turns out that we can just grab a copy of the `Utf8JsonReader` object by assigning it to a new variable.  Because it's a struct, all of its data is just copied directly, and we can modify the copy all we want without affecting the original.  This lets us utilize the tokenization and everything else that has already been performed to build the reader without having to repeat that work.

Now we are free to parse out a `JsonNode` and validate it with our schema.  So far, our converter looks like this:

```c#
public override T? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
{
    var readerCopy = reader;
    var node = JsonSerializer.Deserialize<JsonNode?>(ref readerCopy, options);
    
    var validation = _schema.Evaluate(node, new EvaluationOptions
    {
        OutputFormat = OutputFormat,
        Log = Log!,
        RequireFormatValidation = RequireFormatValidation
    });

    if (validation.IsValid)
    {
        // TODO: deserialize the model
    }

    throw new JsonException("JSON does not meet schema requirements")
    {
        Data =
        {
            ["validation"] = validation
        }
    };
}
```

That's most of it.  Now we just need to invoke the deserializer again, but we need to be careful that we don't cause a recursive loop.  To avoid this, we can create a copy of the serializer options, remove our converter (the factory), and just deserialize normally.

```c#
if (validation.IsValid)
{
    // _optionsFactory is a delegate that's passed into the converter
    // that copies the options and removes the converter factory
    // so we don't enter an recursive loop
    var newOptions = _optionsFactory(options);
    return JsonSerializer.Deserialize<T>(ref reader, newOptions);
}
```

## Declaring the schema

Now that we have the hard bit out of the way, let's work on that attribute.

We want to get the schema dynamically at runtime.  The best way to do this is by following the example of unit test frameworks such as NUnit and XUnit.

Both of these frameworks allow the developer to specify test cases by exposing a property that returns them.  I use this to run the JSON Schema Test Suite: I can load the files from the disk, read all of the tests they contain, and return a massive collection with all of the test cases.  The key part, though, is that the test cases aren't known until the test suite runs.

The way these work is by adding an attribute to the test method that gives the name of a property or method on the test class that will return the cases.  We'll do something similar, but we don't want to restrict developers into defining the schema in the model, so we'll also need the type that declares that member.

For example, if we wanted to have all of our model schemas available in a static class called `ModelSchemas`, we could add this attribute to `MyModel`:

```c#
[JsonSchema(typeof(ModelSchemas), nameof(ModelSchemas.MyModelSchema))]
```

Now the attribute can reflectively load the type, find that property (fields are also supported the way I built it), and invoke it to get the value.  Now the attribute has the schema which can be used later by `ValidatingJsonConverter`.

## Putting it all together

First, let's define our schema.  We wanted to put this in a static class, so here's the declaration:

```c#
public static class ModelSchemas
{
    public static readonly JsonSchema MyModelSchema = 
        new JsonSchemaBuilder()
            .Type(JsonSchemaType.Object)
            .Properties(
                (nameof(MyModel.Foo), new JsonSchemaBuilder()
                    .Type(JsonSchemaType.String)
                    .Minimum(10)
                    .Maximum(50)
                ),
                (nameof(MyModel.Bar), new JsonSchemaBuilder()
                    .Type(JsonSchemaType.Integer)
                    .Minimum(0)
                ),
                (nameof(MyModel.Baz), new JsonSchemaBuilder()
                    .Type(JsonSchemaType.String)
                    .Format(Formats.DateTime)
                )
            )
            .Required(nameof(MyModel.Baz));
}
```

Now let's attach that to our model:

```c#
[JsonSchema(typeof(ModelSchemas), nameof(ModelSchemas.MyModelSchema))]
public class MyModel
{
    public string Foo { get; set; }
    public int Bar { get; set; }
    public DateTime Baz { get; set; }
}
```

And finally, when we deserialize, we need to include `ValidatingJsonConverter`:

```c#
var jsonText = @"{
  ""Foo"": ""foo"",
  ""Bar"": -42
}";
var converter = new ValidatingJsonConverter();
var options = new JsonSerializerOptions { Converters = { converter } };
var myModel = JsonSerializer.Deserialize<MyModel>(jsonText, options);
```

This will throw a `JsonException` that carries an `EvaluationResults` in its `.Data` dictionary under `"validation"`.  The validation results will show that validation failed, but that's it.

To get more detailed output, you need to configure the validation using the converter.

```c#
var jsonText = @"{
  ""Foo"": ""foo"",
  ""Bar"": -42
}";
var converter = new ValidatingJsonConverter;
{
    OutputFormat = OutputFormat.List
}
var options = new JsonSerializerOptions { Converters = { converter } };
var myModel = JsonSerializer.Deserialize<MyModel>(jsonText, options);
```

Now it will give errors.

- `Foo` is too short
- `Bar` must be greater than zero
- `Baz` is missing

So what about this data?

```json
{
  "Foo": "foo is long enough",
  "Bar": 42,
  "Baz": "May 1, 2023"
}
```

Here, everything is right except for the format of `Baz`.  It needs to be in the right format.  It _is_ a date, but JSON Schema requires RFC 3339 formats for date/time.

Also, the `format` keyword is an annotation by default, which means it's not even validated, so this would pass validation and then explode during deserialization.

To fix this, we need to add another option to the converter:

```c#
var jsonText = @"{
  ""Foo"": ""foo"",
  ""Bar"": -42
}";
var converter = new ValidatingJsonConverter;
{
    OutputFormat = OutputFormat.List,
    RequireFormatValidation = true
}
var options = new JsonSerializerOptions { Converters = { converter } };
var myModel = JsonSerializer.Deserialize<MyModel>(jsonText, options);
```

There.  Now it will validate the format and... still explode.  But it'll explode for the right reason this time, with proper JSON Schema output.

## Bonus material

It turns out that while JSON Schema's `date-time` format requires RFC 3339 formatting, .Net's serializer requires ISO 8601-1:2019 formatting, which has [a little overlap](https://ijmacd.github.io/rfc3339-iso8601/) but isn't exactly the same.

Dates in the format `2023-05-01T02:09:48.54Z` will generally be acceptable by both.

I've opened an [issue](https://github.com/dotnet/runtime/issues/85545) with the .Net team to see if I can persuade them to be more tolerant of date/times during deserialization.  Short of waiting for that, you can create a custom format that checks for 8601-1:2019 date/times.
