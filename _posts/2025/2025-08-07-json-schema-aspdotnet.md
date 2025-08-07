---
title: "Built-in ASP.Net Validation for API Requests"
date: 2025-08-07 09:00:00 +1200
tags: [.net, asp.net, api, validation]
toc: true
pin: false
---

I've been playing around with the [validating JSON converter](https://docs.json-everything.net/schema/serialization/) a lot at work lately, and sharing this cool feature with my coworkers yielded some interesting feedback that helped expand its capabilities.

In this post, we'll look at those improvements, how to incorporate that validation directly into the ASP.Net pipeline, and how I discovered a way I could be comfortable with runtime schema generation.

## The validating JSON converter

A more extensive explanation can be found in the docs linked above, but I'd still like to give a quick overview.

_System.Text.Json_ comes with an ultra-efficient serializer that converts between JSON text and .Net models with ease.  Its primary shortcoming, however, is validation.  Because .Net is so strongly typed, the serializer can handle type validation pretty well, but anything more than that is left to a secondary system that runs _after_ the model is created.

The `ValidatingJsonConverter` in _JsonSchema.Net_ is the answer to that problem.  This converter uses a JSON Schema that is attached to a type through a `[JsonSchema]` attribute to hook into the serializer itself and perform validation on the incoming JSON text _prior to_ creating a model.

In this way, validation becomes declarative.

## Integration with ASP.Net

Taking a quick look at a typical controller and route handler method:

```c#
[Route("{Controller}")]
public class PersonController
{
    [HttpPost]
    public IActionResult CreatePerson([FromBody] PersonModel person)
    {
        // ...
    }
}
```

you can see that by the time the method is invoked, any serialization has taken place.  I think this may have driven the "deserialize, then validate" design that exists out of the box.

To hook into the serialization, we have to backtrack into the pipeline.  This requires three additional objects: a model binder (and its provider) and a filter.

### The model binder

The model binder handles the part we're talking about here: hooking into the serialization itself.

```c#
public class ValidatingJsonModelBinder : IModelBinder
{
    public async Task BindModelAsync(ModelBindingContext bindingContext)
    {
        if (bindingContext == null)
            throw new ArgumentNullException(nameof(bindingContext));

        // For body binding, we need to read the request body
        if (bindingContext.BindingSource == BindingSource.Body)
        {
            bindingContext.HttpContext.Request.EnableBuffering();
            using var reader = new StreamReader(
                bindingContext.HttpContext.Request.Body,
                leaveOpen: true);
            var body = await reader.ReadToEndAsync();
            bindingContext.HttpContext.Request.Body.Position = 0;

            if (string.IsNullOrEmpty(body)) return;

            try
            {
                var options = bindingContext.HttpContext.RequestServices
                    .GetRequiredService<IOptions<JsonOptions>>()
                    .Value.JsonSerializerOptions;
                var model = JsonSerializer
                    .Deserialize(body, bindingContext.ModelType, options);
                bindingContext.Result = ModelBindingResult.Success(model);
            }
            catch (JsonException jsonException)
            {
                if (jsonException.Data.Contains("validation") && 
                    jsonException.Data["validation"] is EvaluationResults results)
                {
                    var errors = ExtractValidationErrors(results);
                    if (errors.Any())
                    {
                        foreach (var error in errors)
                        {
                            bindingContext.ModelState
                                .AddModelError(error.Path, error.Message);
                        }
                        bindingContext.Result = ModelBindingResult.Failed();
                        return;
                    }
                }

                bindingContext.ModelState
                    .AddModelError(bindingContext.FieldName,
                        jsonException,
                        bindingContext.ModelMetadata);
                bindingContext.Result = ModelBindingResult.Failed();
            }
            return;
        }

        // For other binding sources, use the value provider
        var valueProviderResult = bindingContext.ValueProvider
            .GetValue(bindingContext.ModelName);
        if (valueProviderResult == ValueProviderResult.None) return;

        bindingContext.ModelState
            .SetModelValue(bindingContext.ModelName, valueProviderResult);

        try
        {
            var value = valueProviderResult.FirstValue;
            if (string.IsNullOrEmpty(value)) return;

            var options = bindingContext.HttpContext.RequestServices
                .GetRequiredService<IOptions<JsonOptions>>().Value.JsonSerializerOptions;
            var model = JsonSerializer
                .Deserialize(value, bindingContext.ModelType, options);
            bindingContext.Result = ModelBindingResult.Success(model);
        }
        catch (JsonException jsonException)
        {
            bindingContext.ModelState
                .AddModelError(bindingContext.ModelName,
                    jsonException, 
                    bindingContext.ModelMetadata);
            bindingContext.Result = ModelBindingResult.Failed();
        }
    }

    static List<(string Path, string Message)> ExtractValidationErrors(
        EvaluationResults validationResults)
    {
        var errors = new List<(string Path, string Message)>();
        ExtractValidationErrorsRecursive(validationResults, errors);
        return errors;
    }

    static void ExtractValidationErrorsRecursive(
        EvaluationResults results, 
        List<(string Path, string Message)> errors)
    {
        if (results.IsValid) return;

        if (results.Errors != null)
        {
            foreach (var error in results.Errors)
            {
                errors.Add((results.InstanceLocation.ToString(), error.Value));
            }
        }

        foreach (var detail in results.Details)
        {
            ExtractValidationErrorsRecursive(detail, errors);
        }
    }
}
```

And then we need a model binder provider.  This class actually gets registered with the DI container.

```c#
public class ValidatingJsonModelBinderProvider : IModelBinderProvider
{
    public IModelBinder? GetBinder(ModelBinderProviderContext context)
    {
        if (context == null)
            throw new ArgumentNullException(nameof(context));

        // Only use this binder for types that have the [JsonSchema] attribute
        if (context.Metadata.ModelType.GetCustomAttributes(
                typeof(JsonSchemaAttribute), true).Any())
            return new ValidatingJsonModelBinder();

        return null;
    }
}
```

### The filter

The filter handles binding failures and builds the Problem Details response.  We need to implement two interfaces.

- `IActionFilter` handles partial binding success, like when there are multiple parameters in the method, and some of the parameters bind successfully.
- `IAlwaysRunResultFilter` handles total binding failure.

I haven't really dug into the critical differences, but I discovered that we need both.  For what it's worth, Google's AI had to say this:

> The primary distinction lies in their scope and guarantee of execution. `IActionFilter` targets the action method execution itself, while `IAlwaysRunResultFilter` focuses on the action result execution and guarantees its execution even if other filters short-circuit the pipeline. 

```c#
public class JsonSchemaValidationFilter : IActionFilter, IAlwaysRunResultFilter
{
    public void OnActionExecuting(ActionExecutingContext context)
    {
        // this method seems to handle partial binding success
        var check = HandleJsonSchemaErrors(context);
        if (check is not null) context.Result = check;
    }

    public void OnResultExecuting(ResultExecutingContext context)
    {
        // this method seems to handle total binding failure
        var check = HandleJsonSchemaErrors(context);
        if (check is not null) context.Result = check;
    }

    static IActionResult? HandleJsonSchemaErrors(FilterContext context)
    {
        if (context.ModelState.IsValid) return null;
        var errors = context.ModelState
            .Where(x => x.Value?.Errors.Any() == true)
            .SelectMany(x => x.Value!.Errors.Select(e => new
            {
                Path = x.Key,
                Message = e.ErrorMessage,
            }))
            .Where(e => string.IsNullOrEmpty(e.Path) || e.Path.StartsWith('/'))
            .GroupBy(x => x.Path)
            .ToDictionary(x => x.Key, x => x.Select(e => e.Message).ToList());

        // If we don't have JSON Pointer errors, JSON Schema didn't handle this.
        // Don't change anything.
        if (errors.Count == 0) return null;

        var problemDetails = new ProblemDetails
        {
            Type = "https://zeil.com/errors/validation",
            Title = "Validation Error",
            Status = 400,
            Detail = "One or more validation errors occurred.",
            Extensions = { ["errors"] = errors }
        };

        return new BadRequestObjectResult(problemDetails);

    }

    public void OnActionExecuted(ActionExecutedContext context) { } // no-op

    public void OnResultExecuted(ResultExecutedContext context) { } // no-op
} 
```

### Integration with ASP.Net

To hook everything up, we need to edit the application startup:

```c#
var builder = WebApplication.CreateBuilder(args);
var mvcBuilder = s.AddControllersWithViews(o =>  // or just .AddControllers()
{
    // add the filter
    o.Filters.Add<JsonSchemaValidationFilter>();
    // add the binder at the start
    o.ModelBinderProviders.Insert(0, new ValidatingJsonModelBinderProvider());
}).AddJsonOptions(o =>
{
    o.JsonSerializerOptions.Converters.Add(new ValidatingJsonConverter
        {
            Options =
            {
                OutputFormat = OutputFormat.Hierarchical,
                RequireFormatValidation = true,
            }
        }
    );
});
```

## Feedback from coworkers

The feedback I received after adding this validation to several of my API models and integrating it into the ASP.Net pipeline was varied but mostly good.

They loved the idea of adding this kind of validation.  They really loved that it automatically produced a 400 Bad Request response, in [Problem Details](https://datatracker.ietf.org/doc/html/rfc7807) format and complete with schema-generated errors, when validation failed.

What they didn't like was the cruft of explicitly writing out the schema for every type.

A small model can be validated fairly easily:

```c#
[JsonSchema(typeof(Person), nameof(Schema))]
class Person
{
    public static JsonSchema Schema = 
        new JsonSchemaBuilder()
            .Type(JsonSchemaType.Object)
            .Properties(
                ("name", new JsonSchemaBuilder()),
                ("age", new JsonSchemaBuilder().Type(JsonSchemaType.Integer))
            );

    public string Name { get; set; }
    public int Age { get; set; }
}
```

However, it's easy to see how this can be quite complex and cumbersome as the model grows.

The answer was to let the system generate the schemas.

## Accepting schema generation

Generating the schemas from the model types would reduce the cruft and lower the bar for other developers to begin validating requests with schemas.  (I guess others just don't derive the joy I do from writing schemas.)

I began by creating a new attribute: `[GenerateJsonSchema]`.  Then I had to copy the `ValidatingSchemaConverter` (because inheriting it wasn't an option the way I had written it) to a new version that also handled my new attribute as well as the original `[JsonSchema]` attribute.

> Generating schemas is usually good for most types, but sometimes you need validation that the generation doesn't support.  For those, we still need to support the explicit approach.
{: .prompt-info }

Then I just needed to update a few things we've previously created.

- The binder provider needs to react to the new attribute.
    ```c#
    public class ValidatingJsonModelBinderProvider : IModelBinderProvider
    {
        public IModelBinder? GetBinder(ModelBinderProviderContext context)
        {
            if (context == null)
                throw new ArgumentNullException(nameof(context));

            if (context.Metadata.ModelType.GetCustomAttributes(
                    typeof(JsonSchemaAttribute), true).Any()) ||
                context.Metadata.ModelType.GetCustomAttributes(
                    typeof(GenerateJsonSchemaAttribute), true).Any())
                return new ValidatingJsonModelBinder();

            return null;
        }
    }
    ```
- We need to register the new converter in the `JsonSerializerOptions`
    ```c#
    o.JsonSerializerOptions.Converters.Add(new ValidatingJsonConverter
        {
            Options =
            {
                OutputFormat = OutputFormat.Hierarchical,
                RequireFormatValidation = true,
            }
        }
    );
    ```

## Ensuring quality

I've generally not trusted schema generation (even generation that I wrote) in production system.  The only way that I can accept it is if the generated schemas are checked by a human developer at dev-time.

I landed on approval tests as a way to enforce that the schema for any given type is checked.  An approval test runs within the unit test framework and outputs a file that is committed to the repository.  Later, when a developer makes a change, the unit test runs again.  If the newly generated approval text differs from what is saved, the approval framework can open a diff editor (e.g. VS Code) to alert the user and allow them to accept the changes by merging them into the committed file.  Those changes can then be reviewed in a PR.

Specifically, I had two tests: one that generated schema approvals for each of the types that were decorated with the `[GenerateJsonSchema]` attribute (for human verification of the schema itself), and one that finds any request models that don't have schema validation (to prevent new schema-less requests from being created).

```c#
public class JsonSchemaGenerationTests
{
    static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    static readonly SchemaGeneratorConfiguration GenerationConfig = new()
    {
        PropertyNameResolver = PropertyNameResolvers.CamelCase,
    };

    public class TypeWrapper(Type type)
    {
        public Type Type { get; } = type;

        public override string ToString() => Type.Name;
    }

    public static IEnumerable<object[]> TypesThatGenerateJsonSchemas
    {
        get
        {
            var webAssembly = typeof(Program).Assembly;
            var typesWithAttribute = webAssembly.GetTypes()
                .Where(type => type.GetCustomAttribute<GenerateJsonSchemaAttribute>() != null)
                .OrderBy(type => type.FullName)
                .ToList();

            return typesWithAttribute.Select(type => new object[] { new TypeWrapper(type) });
        }
    }

    [Theory]
    [MemberData(nameof(TypesThatGenerateJsonSchemas))]
    public void JsonSchemaGeneration(TypeWrapper type)
    {
        JsonSchema schema = new JsonSchemaBuilder().FromType(type.Type, GenerationConfig);
        
        var schemaJson = JsonSerializer.Serialize(schema, JsonOptions);
        
        this.Assent(schemaJson, new Configuration()
            .UsingExtension("json")
            .UsingApprovalFileNameSuffix($"_{type}")
        );
    }

    [Fact]
    public void ModelsWithoutJsonSchemaValidation()
    {
        var webAssembly = typeof(Program).Assembly;
        
        var controllerTypes = webAssembly.GetTypes()
            .Where(t => t is { IsClass: true, IsAbstract: false } &&
                        t.IsAssignableTo(typeof(Controller)))
            .ToList();

        var missingJsonSchemaModels =
            new List<(Type ControllerType, MethodInfo Method, Type ParameterType)>();

        foreach (var controllerType in controllerTypes)
        {
            var methods = controllerType
                .GetMethods(BindingFlags.Public | BindingFlags.Instance)
                .Where(m => m.GetCustomAttributes<HttpMethodAttribute>().Any() ||
                            m.GetCustomAttributes<HttpPostAttribute>().Any() ||
                            m.GetCustomAttributes<HttpPutAttribute>().Any() ||
                            m.GetCustomAttributes<HttpPatchAttribute>().Any())
                .ToList();

            foreach (var method in methods)
            {
                var parameters = method.GetParameters()
                    .Where(p => p.ParameterType.Namespace?.StartsWith("Zeil") == true)
                    .ToList();

                foreach (var parameter in parameters)
                {
                    // don't check parameters that we know aren't coming in as JSON
                    var isExplicitlyNotJson =
                        parameter.GetCustomAttribute<FromRouteAttribute>() != null ||
                        parameter.GetCustomAttribute<FromQueryAttribute>() != null ||
                        parameter.GetCustomAttribute<FromFormAttribute>() != null ||
                        parameter.GetCustomAttribute<FromHeaderAttribute>() != null;

                    if (isExplicitlyNotJson) continue;

                    var parameterType = parameter.ParameterType;
                    var supportsSchemaValidation = 
                        parameterType.GetCustomAttribute<GenerateJsonSchemaAttribute>() != null ||
                        parameterType.GetCustomAttribute<JsonSchemaAttribute>() != null;

                    if (supportsSchemaValidation) continue;

                    missingJsonSchemaModels.Add((
                        controllerType,
                        method,
                        parameterType
                    ));
                }
            }
        }

        var groupedByType = missingJsonSchemaModels
            .GroupBy(m => m.ParameterType.FullName ?? m.ParameterType.Name)
            .OrderBy(g => g.Key)
            .ToList();

        var reportLines = new List<string>();
        foreach (var group in groupedByType)
        {
            reportLines.Add(group.Key);
            
            var controllerMethods = group
                .Select(m => $"    {m.ControllerType.FullName ?? m.ControllerType.Name}.{m.Method.Name}")
                .Distinct()
                .OrderBy(method => method)
                .ToList();
            
            reportLines.AddRange(controllerMethods);
        }

        var reportText = string.Join(Environment.NewLine, reportLines);
        this.Assent(reportText, new Configuration().UsingExtension("txt"));
    }
}
```

These tests allow me to sleep at night, knowing that any generated code had been checked.

## For the masses

I have pulled the new `[GenerateJsonSchema]` attribute and the new `GenerativeValidatingJsonConverter` into _JsonSchema.Net.Generation_ for you.  You'll need to copy and adapt the rest into your solution, though.

Better APIs for everyone!

_If you like the work I put out, and would like to help ensure that I keep it up, please consider [becoming a sponsor](https://github.com/sponsors/gregsdennis)!_
