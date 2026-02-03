# Pixels Schema and Validation

This repository holds the JSON schema and code for validating pixel definitions defined by each of DuckDuckGo's products.

We uses pixels to improve our product and to understand how it is being used.
Except for cases where users purposefully share sensitive or identifying information with us, such as,
in a breakage report, DuckDuckGo pixels are anonymous.
To learn more about our pixels, visit: https://duckduckgo.com/duckduckgo-help-pages/privacy/atb/

Note: The effort to define our pixels is on-going. Not all our product repositories will contain pixel definitions.

## Quick Links
- [Setup](#setup)
- [Documenting a pixel](#documenting-a-pixel)
  - [Experiment pixels](#experiment-pixels)
  - [All other pixels](#all-other-pixels)
- [Validation](#validation)
  - [Pre-requisites](#pre-requisites)
  - [Validating Definitions](#validating-definitions)
  - [Live Pixel Validation](#live-pixel-validation)

## Setup
A repository that supports pixel definitions will have a folder setup with roughly the following structure:
```
RepoSpecificPixelFolder
    --> pixels [directory that can contain sub-directories with various .json files]
        --> feature1 [directory for pixels related to 'feature1']
            --> interaction_pixels.json
            --> crash_pixels.json
            --> ...
        --> other_pixels.json [file for any pixels that do not belong to a feature folder]
        --> ...
    --> params_dictionary.json [file that defines commonly used parameters]
    --> suffixes_dictionary.json [file that defines commonly used suffixes]
    --> native_experiments.json [file that defines pixels sent by the native experiments framework]
    --> asana_notify.json [file that lists users (github user ids) who wish to be regularly notified of pixel errors in this repo]
```

You can organize the files and sub-directories within `pixels` however you like, the example above is just one option.

## Documenting a pixel
### Experiment pixels
Pixels sent by the [native experiments framework](https://app.asana.com/1/137249556945/project/1208889145294658/task/1209331148407154?focus=true)
must be documented separately in `native_experiments.json` and adhere to the [native experiments schema](./schemas/native_experiments.schema.json5).

**Fields**:
* `defaultSuffixes`: defines what suffixes are appended to each pixel after the cohort
  * Example: Android appends `.android.[phone|tablet]` to its pixels
  * See [Pixels with dynamic names](#pixels-with-dynamic-names) for more info on how to define these
* `activeExperiments`: defines each experiment with the key being the name of the experiment. Each experiment must also define:
  * `cohorts`: an array of Strings defining each cohort in the experiment
  * `metrics`: a collection of objects where each object is keyed by the metric name as it would appear in the pixel. Each metric must also provide:
    * `description` of the metric
    * `enum` of possible values; if you don't specify a corresponding `type` for the enum then `string` is assumed.

**Note**: The following are pre-defined and are automatically taken into account by the pixel schema
(you do not need to worry about defining them):
* `enrollmentDate` and `conversionWindowDays` parameters
* `app_use` and `search` metrics

**Example definition**: [native_experiments.json](./tests/test_data/valid/pixels/native_experiments.json)

### All other pixels
* All other pixels must be defined in any file within the `pixels` directory and its children
* Each JSON file can contain multiple pixels, keyed by the static portion of the pixel name
    * Add your pixel where it makes the most sense
    * You can use either JSON or JSON5 (JSON with comments, trailing commas) to document your pixels
* Pixel definitions must adhere to the [pixel schema](./schemas/pixel_schema.json5)

Below, you'll find a walkthrough of the schema requirements and options.
As you read through, you can refer to the [pixel_guide.json](./tests/test_data/valid/pixels/definitions/pixel_guide.json5) for examples.

#### Minimum requirements
Each pixel **must** contain the following properties:
* `description` - when the pixel fires and its purpose
* `owners` - Github usernames of who to contact about the pixel
* `triggers` - one or more of the [possible triggers](./schemas/pixel_schema.json5#27) that apply to the pixel:
  * `page_load`: pixel fires when a webpage is loaded
  * `new_tab`: pixel fires when a new tab is opened
  * `search_ddg`: pixel fires when user performs a search
  * `startup`: pixel fires on app startup
  * `scheduled`: pixel fires periodically
  * `user_submitted`: pixel fires when user submits a form
  * `exception`: pixel fires when an exception/crash occurs
  * `other`: catch-all

Additionally, a pixel **may** contain the following properties:
* `requireVersion` - when set to `true`, **live validation** will treat any pixel instances without a version param as being out of date.  Defaults to `false`.

#### Pixels with dynamic names
If the pixel name is parameterized, you can utilize the `suffixes` property.

Required properties for each suffix:
* `description`

Optional properties for each suffix:
* `key` - static portion of the suffix
* JSON schema types - used to indicate constrained values for the suffix. Can be anything from https://json-schema.org/understanding-json-schema/reference/type

Note:
* You can utilize a 'shortcut' to point to a common suffix that's predefined in `suffixes_dictionary.json`
  * See `device_type` in [pixel_guide.json](./tests/test_data/valid/pixels/definitions/pixel_guide.json5)
  and [suffixes_dictionary.json](./tests/test_data/valid/pixels/suffixes_dictionary.json)
* Ordering of suffixes matters, and all suffixes in a given set *are required*.  To specify optional or different combinations of suffixes, you can represent them as nested arrays:
```
suffixes: [
   ['first_daily_count', 'platform', 'form_factor'],
   ['platform', 'form_factor']
]
```

#### Pixels with parameters
If the pixel contains parameters, you can utilize the `parameters` property.

Required properties for each parameter:
* `key` - parameter key
  * As an alternative, you can use `keyPattern` to define dynamic parameter keys.
  Note that such cases are unusual and should be avoided if possible.
* `description`

Optional properties for each parameter:
* JSON schema types - used to indicate constrained parameter values. Can be anything from https://json-schema.org/understanding-json-schema/reference/type

* You can utilize a 'shortcut' to point to a common parameter that's predefined in `params_dictionary.json`
  * See `appVersion` in [pixel_guide.json](./tests/test_data/valid/pixels/definitions/pixel_guide.json5)
  and [params_dictionary.json](./tests/test_data/valid/pixels/params_dictionary.json)
* Unlike suffixes, parameters are order independent

#### Temporary pixels
If the pixel is temporary, set an expiration date in the `expires` property.

## Validation
There are two types of validation when it comes to pixel definitions:
* **Validating definitions**: ensures that pixel definitions conform to the [schema](./schemas/pixel_schema.json5) and follow a consistent format.
    * Runs as part of CI, but you can also run it manually - see [Validating Definitions](#validating-definitions) below for details
* **Live pixel validation**: ensures whatever pixels we send/receive match their schema definitions.
    * Runs weekly via a Jenkins job and generates reports in the [Pixel Validation Asana project](https://app.asana.com/1/137249556945/project/1210856607616307/list/1210856614738826)
    * You can also run this validation manually - see [Live Pixel Validation](#live-pixel-validation) below for details

*Note*: A repository that supports pixel definitions will have a folder setup with `package.json` pointing to this module, referred to as `PackageFolder` below.

### Pre-requisites
To run validation manually, you will need to:
* Install Node.js: see instructions in https://nodejs.org/en/download
* Install dependencies:
    ```
    $ cd ${PackageFolder}
    $ npm i
    ```

### Validating Definitions
```
$ cd ${PackageFolder}
$ npm run validate-defs
```
Note:
* If formatting errors are found, you can fix them with `npm run lint.fix`
* You can check pixel owner names against a valid list of [Github user ids](https://github.com/duckduckgo/internal-github-asana-utils/blob/main/user_map.yml) with the `--githubUserMap` option
* For schema validation failures, check the output and apply fixes manually
* You can also (re)validate a single file:
    * Schema validation: `npx validate-ddg-pixel-defs . -f ${path to file relative to PackageFolder/pixels/ directory}`
    * Formatting: `npx prettier ${path to file relative to PackageFolder/ directory} --check`

### Live Pixel Validation
#### Validating Pixels from Client Logs
This is the quickest method to validate any new definitions you are working on. Steps:
* Generate a debug log that prints out which pixels were sent in a URL params format (e.g. `m_uri_loaded_android_phone?appVersion=5.264.1&test=1`).
    * For example, for Android, you can run `adb logcat -v raw -s NetworkModule -e '^Pixel url request:' | tee output.log`
* Run the validation tool:
    ```
    $ cd ${PackageFolder}
    $ npm run validate-pixel-debug-logs <Path to pixel defintions> <Path to debug log> <Pixel Prefix>
    ```
    * `<Path to pixel defintions>` - will typically be the same as the `PackageFolder`, so you can just use `.`
    * `<Path to debug log>` - path to the debug log you generated, e.g. `output.log`
    * `<Pixel Prefix>` - a string to match against that begins the log line and comes right before the pixel name
        * On Android this is currently `'Pixel url request: https://improving.duckduckgo.com/t/'`
        * On Windows this is currently `'Log: Debug: Published Pixel'`
    * Full example for Android: `npm run validate-pixel-debug-logs . output.log 'Pixel url request: https://improving.duckduckgo.com/t/'`

#### Validating Pixels in Clickhouse
**Jenkins Job**: 
To avoid having to put your pixel defintions on a dev node and setup there, simply use the
[Dev Pixel Validation](https://jenkins.duckduckgo.com/job/Privacy/job/Dev%20Pixel%20Validation/) Jenkins job:
* Select Build with Parameters
* Input params as needed for your setup
* Click Build
* Grab a coffee if validating all pixels

**Running on a Dev Node**:
1. Clone your repo with your latest defintions to your dev node
2. Clone this pixel schema repo: `git clone https://github.com/duckduckgo/pixel-schema.git`
3. Setup:
    ```
    $ cd git/pixel-schema
    $ npm run preprocess-defs <Path to your client repo's PixelDefintions>
    $ npm run fetch-clickhouse-data <Path to your client repo's PixelDefintions>
    ```
    * Optionally, you can also pass in a specific pixel prefix you are intersted in to avoid fetching all pixels - this will speed up both the Clickhouse fetching script and the validation
    * Example: `npm run fetch-clickhouse-data ../apple-browsers/iOS/PixelDefinitions/ m.subscription.tier-options`

4. Validate: `./scripts/revalidateRepo.sh <Path to your client repo's PixelDefintions>`
5. Review errors in `<Path to your client repo's PixelDefintions/pixels/pixel_processing_results/>`

As needed, you can re-run step 4 and step 5 after updating your definitions.

## License
DuckDuckGo Pixels Schema is distributed under the [Apache 2.0 License](LICENSE).

## Questions
* **How can I contribute to this repository?** We are not accepting external pull requests at this time.
Security bugs can be submitted through our [bounty program](https://hackerone.com/duckduckgo/reports/new?type=team&report_type=vulnerability) or by sending an email to security@duckduckgo.
