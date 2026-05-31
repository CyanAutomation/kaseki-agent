# Changelog

All notable changes to Kaseki Agent are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.56.2](https://github.com/CyanAutomation/kaseki-agent/compare/v1.56.1...v1.56.2) (2026-05-31)


### Bug Fixes

* defer cancelled job artifact writes and add SIGKILL escalation on cancel ([#497](https://github.com/CyanAutomation/kaseki-agent/issues/497)) ([1e93584](https://github.com/CyanAutomation/kaseki-agent/commit/1e935843e48b288e3379378009e013fe4dd87c45))
* defer cancelled job artifacts until exit ([a8e59f9](https://github.com/CyanAutomation/kaseki-agent/commit/a8e59f9ce248cbaba01b85d6afeebd144aa0ed2d))
* the race condition in JobScheduler.cancelJob() where... (kaseki-82) ([#496](https://github.com/CyanAutomation/kaseki-agent/issues/496)) ([7b40a7c](https://github.com/CyanAutomation/kaseki-agent/commit/7b40a7c3af0ad5b63e77f0c0cc6fe87926c96083))

## [1.56.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.56.0...v1.56.1) (2026-05-31)


### Bug Fixes

* Webhook delivery can race and send the same event mu... (kaseki-79) ([#484](https://github.com/CyanAutomation/kaseki-agent/issues/484)) ([48d5177](https://github.com/CyanAutomation/kaseki-agent/commit/48d5177e1842cb733d4cce5b275876807c122466))

# [1.56.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.55.1...v1.56.0) (2026-05-30)


### Bug Fixes

* Correct script path variable and improve console output formatting in feedback analysis scripts ([c18d1b0](https://github.com/CyanAutomation/kaseki-agent/commit/c18d1b05044da0ccc83e8b37712533c2a7319c94))
* make lock acquisition waits async ([17dd780](https://github.com/CyanAutomation/kaseki-agent/commit/17dd780205f4bf5461505d77ae1c49cb441a2ee5))
* Pre-validation during scouting mostly exists, but cl... (kaseki-76) ([#453](https://github.com/CyanAutomation/kaseki-agent/issues/453)) ([0670244](https://github.com/CyanAutomation/kaseki-agent/commit/06702447b16e34f18183334e43113be29a43ee5d))
* Refactor job scheduler and idempotency store for improved readability; update API version to 1.55.1; enhance test scripts with shellcheck directives ([5ddcdf3](https://github.com/CyanAutomation/kaseki-agent/commit/5ddcdf3d56159220e57465d21a9e4f8b28a190a7))


### Features

* Add evaluation enhancements rollout checklist and update contributing guidelines ([4a29e84](https://github.com/CyanAutomation/kaseki-agent/commit/4a29e84068e2d23ad56a79c32c93f8b896b71bd0))
* Add practical guide for goal-setting improvements and implement feedback infrastructure ([5b22562](https://github.com/CyanAutomation/kaseki-agent/commit/5b22562f14080f2bec892d858021af55d9aa9f4a))
* Enhance goal-setting feedback loop with additional metrics and improve test output clarity ([50c7047](https://github.com/CyanAutomation/kaseki-agent/commit/50c7047f18029c2110283b672a7baf2197d0f5f8))
* Implement feedback loop integration for Kaseki agent evaluations ([2c1e205](https://github.com/CyanAutomation/kaseki-agent/commit/2c1e205d64c145e72e3f0a9ed39d0066f3bbf31d))
* Implement GitHub issues fetching functionality and enhance GitHub App token generation ([a52bae0](https://github.com/CyanAutomation/kaseki-agent/commit/a52bae083693b137217ef8301969620f703c539d))
* Implement recent repositories dropdown in web interface; add functionality to manage recent repo URLs ([3a437dd](https://github.com/CyanAutomation/kaseki-agent/commit/3a437dd7480e018c045532314e9dbefb770f4836))
* Introduce goal-setting agent for pre-scouting prompt enhancement; add configuration options and documentation ([4445250](https://github.com/CyanAutomation/kaseki-agent/commit/4445250b749b920e367e2eb5abe5a7d54b46d469))

## [1.55.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.55.0...v1.55.1) (2026-05-27)


### Bug Fixes

* Enhance debugging output in health check and update mock helper behavior for testing ([1d46069](https://github.com/CyanAutomation/kaseki-agent/commit/1d4606985dbfa45c6c3cf725e548fa8b2b2bf97f))
* Enhance health check for github-app-token helper and improve test environment variable handling ([98a9462](https://github.com/CyanAutomation/kaseki-agent/commit/98a9462c5238c0043a9cc613d6e57fa89d4150af))
* Improve health check tests by enhancing temporary directory handling and error classification ([5837514](https://github.com/CyanAutomation/kaseki-agent/commit/5837514e516a1d23acde26cce922acca1f5fd414))
* Refactor health check logging and improve test output handling ([b5c5d2d](https://github.com/CyanAutomation/kaseki-agent/commit/b5c5d2d4f73e882580b88cf49ddf8a781093d7ce))
* tests/inspect-report.test.ts findingMatches existenc... (kaseki-77) ([#452](https://github.com/CyanAutomation/kaseki-agent/issues/452)) ([98b3d1c](https://github.com/CyanAutomation/kaseki-agent/commit/98b3d1c787276f9126200241d58fe8f3e7fcb001))
* Update github-app-token helper mock to output usage and improve error handling in tests ([5b7048e](https://github.com/CyanAutomation/kaseki-agent/commit/5b7048ea41e39e9068c4976b9bf0e1888003288a))
* Update health log variable in github operations health check and adjust tests for improved flexibility ([af9b666](https://github.com/CyanAutomation/kaseki-agent/commit/af9b666a9f26a37b6cf672f47ecf7922385874f8))

# [1.55.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.54.0...v1.55.0) (2026-05-27)


### Features

* Add detailed run progress display and styling to the Kaseki Task Console ([5239f6b](https://github.com/CyanAutomation/kaseki-agent/commit/5239f6bc2c28892ab4d0fd5f5bdbeabfaf80ee5e))
* Update version to 1.54.0 and enhance toolbar button styling for better UI consistency ([d2036ff](https://github.com/CyanAutomation/kaseki-agent/commit/d2036ffee832a4d9d7fab64388bb34d4c235aae1))

# [1.54.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.53.4...v1.54.0) (2026-05-27)


### Features

* Enhance UI styling and accessibility for Kaseki Task Console with updated color scheme, typography, and layout adjustments ([f91e07a](https://github.com/CyanAutomation/kaseki-agent/commit/f91e07ada2b065772c6ff9f19df7d703c2dccefe))
* Integrate Sentry for error tracking and monitoring in kaseki-agent ([ec02f01](https://github.com/CyanAutomation/kaseki-agent/commit/ec02f018f3ac659078712ce1cfe883b5c312b97c))
* Update Sentry configuration and documentation for improved release tracking and environment settings ([6811170](https://github.com/CyanAutomation/kaseki-agent/commit/6811170cdc4414e08930030a2996ba7d5b3dd6f7))

## [1.53.4](https://github.com/CyanAutomation/kaseki-agent/compare/v1.53.3...v1.53.4) (2026-05-27)


### Bug Fixes

* improve concurrency handling in file-helpers atomic tests and update shellcheck directives in failure tests ([1a2679a](https://github.com/CyanAutomation/kaseki-agent/commit/1a2679a10b3a6e46d36f6364d92cbfe3ae96bf59))

## [1.53.3](https://github.com/CyanAutomation/kaseki-agent/compare/v1.53.2...v1.53.3) (2026-05-27)


### Bug Fixes

* build_pr_agent_review depends on an out-of-scope var... (kaseki-74) ([#449](https://github.com/CyanAutomation/kaseki-agent/issues/449)) ([8957e6b](https://github.com/CyanAutomation/kaseki-agent/commit/8957e6b152367083fabdb0b8c289978277c085ba))
* tests/github-operations-failures.test.sh health chec... (kaseki-73) ([#447](https://github.com/CyanAutomation/kaseki-agent/issues/447)) ([20a6796](https://github.com/CyanAutomation/kaseki-agent/commit/20a6796c7923964acba26aa10ec00e1180eb292c))

## [1.53.2](https://github.com/CyanAutomation/kaseki-agent/compare/v1.53.1...v1.53.2) (2026-05-27)


### Bug Fixes

* remove TOCTOU overwrite path in writeIfEmptyAtomic ([622cd11](https://github.com/CyanAutomation/kaseki-agent/commit/622cd11dbb2543f14eba7dc6b7b36b281e31493b))
* remove unnecessary whitespace in failure artifact writer and file helpers ([87ce16e](https://github.com/CyanAutomation/kaseki-agent/commit/87ce16e55f118b2f16680ec7bd90439c2ae4316d))
* TOCTOU checks around file existence/stat before writ... (kaseki-69) ([#437](https://github.com/CyanAutomation/kaseki-agent/issues/437)) ([992b42e](https://github.com/CyanAutomation/kaseki-agent/commit/992b42e76bdc4ea53b55332ace911a0b2475fd0e))

## [1.53.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.53.0...v1.53.1) (2026-05-27)


### Bug Fixes

* Exit handler receives stale tail values (captured be... (kaseki-67) ([#423](https://github.com/CyanAutomation/kaseki-agent/issues/423)) ([24623de](https://github.com/CyanAutomation/kaseki-agent/commit/24623defcaa483e282143a111fd88f4d4ce2f9b8))
* improve run evaluation duration precision ([a3301fb](https://github.com/CyanAutomation/kaseki-agent/commit/a3301fb0efbcc87d76085160247be7989c16f73c))
* improve run-evaluation duration precision and formatting ([#428](https://github.com/CyanAutomation/kaseki-agent/issues/428)) ([8b0fbaf](https://github.com/CyanAutomation/kaseki-agent/commit/8b0fbaf660a48e0ee9631bf7c7d7004a73067083))
* preserve markdown sections in agent evaluation sanitization ([b565451](https://github.com/CyanAutomation/kaseki-agent/commit/b5654515eb261b4b1e9256f5020d6a218e78add9))
* preserve markdown sections in agent evaluation sanitization ([#424](https://github.com/CyanAutomation/kaseki-agent/issues/424)) ([d295cbd](https://github.com/CyanAutomation/kaseki-agent/commit/d295cbd4bcbe877e3cdf58d97c894e96b979c295))

# [1.53.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.52.0...v1.53.0) (2026-05-26)


### Bug Fixes

* bind stdout/stderr listener state to tail refs (follow-up to kaseki-66) ([#422](https://github.com/CyanAutomation/kaseki-agent/issues/422)) ([ca4d00c](https://github.com/CyanAutomation/kaseki-agent/commit/ca4d00c33e13781d232da92638946ad4bb0e48c0))
* correct trap syntax and remove unused variable in test scripts ([41704f3](https://github.com/CyanAutomation/kaseki-agent/commit/41704f355976fa6f731b45d2af274f90663ea4d8))
* pass stream tail refs directly to listener wiring ([b694458](https://github.com/CyanAutomation/kaseki-agent/commit/b69445816c0e56b84289c75f2578f0d8ab3cefde))
* stderr tail is never captured (wrong buffer is updat... (kaseki-66) ([#421](https://github.com/CyanAutomation/kaseki-agent/issues/421)) ([fa1e911](https://github.com/CyanAutomation/kaseki-agent/commit/fa1e911f2a7e1ea16ee206b8e3a3d36e19ebf944))
* update version to 1.52.0 and enhance task progress calculation to prevent overflow errors ([b67aea1](https://github.com/CyanAutomation/kaseki-agent/commit/b67aea1eab6ac97ecb2e9a03885dc2f73d070124))


### Features

* enhance assessment report with structured subsections and increased text limits ([5bf7b4e](https://github.com/CyanAutomation/kaseki-agent/commit/5bf7b4efac5add7c9e0f150f8e5de87068a833bf))

# [1.52.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.51.1...v1.52.0) (2026-05-26)


### Bug Fixes

* add jq to Dockerfile dependencies and validate JSON encoding in GitHub operations ([6d086da](https://github.com/CyanAutomation/kaseki-agent/commit/6d086da66dfd3a5a689fe459695b80b019a7cc68))
* standardize string quotes in diagnostics messages for consistency ([f40b5d5](https://github.com/CyanAutomation/kaseki-agent/commit/f40b5d598803d32e4ee582f3a48cacdde6fa1841))


### Features

* add TypeScript pre-check feature to catch compilation errors early ([bbb3f5d](https://github.com/CyanAutomation/kaseki-agent/commit/bbb3f5d2bc8accb387e606318a0f33ab6e63b782))
* enhance JobScheduler to maintain separate stdout and stderr buffers for improved logging ([84e558f](https://github.com/CyanAutomation/kaseki-agent/commit/84e558fad5f24ca572c27aebeaebc33660153bd0))
* enhance TypeScript pre-check with auto-detection and improved logging ([9c214ab](https://github.com/CyanAutomation/kaseki-agent/commit/9c214ab6ba0923f03a2a115b73d3953869c9462f))
* implement container preflight diagnostics for startup checks and logging ([14861da](https://github.com/CyanAutomation/kaseki-agent/commit/14861da90d28a7404cec8beb596f458114b214cf))

## [1.51.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.51.0...v1.51.1) (2026-05-25)


### Bug Fixes

* Introduce fail-fast option for validation and remove Docker pull check ([24c569f](https://github.com/CyanAutomation/kaseki-agent/commit/24c569f09d2b5b7b10471337ef89eb0789a2d475))

# [1.51.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.50.0...v1.51.0) (2026-05-25)


### Features

* Add task progress tracking and update status response structure ([848a584](https://github.com/CyanAutomation/kaseki-agent/commit/848a584169c3cf13af3e4ded62f506d21212b4c7))
* Add test suite for Task Progress Percentage feature ([d58bd68](https://github.com/CyanAutomation/kaseki-agent/commit/d58bd685eca55a1c81a19d009d007651bde00da5))

# [1.50.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.49.1...v1.50.0) (2026-05-25)


### Bug Fixes

* handle missing patterns gracefully in allowlist validation and improve report generation script formatting ([b5b19a7](https://github.com/CyanAutomation/kaseki-agent/commit/b5b19a7540d1d7416fa8648bebde55034c876d01))
* increase prune threshold for dependency cache to improve performance ([ea2fb1f](https://github.com/CyanAutomation/kaseki-agent/commit/ea2fb1f2471c8aad2d9402b9e4acc5f0a22bf395))


### Features

* enhance inspect mode with report generation and validation improvements ([e74a7b0](https://github.com/CyanAutomation/kaseki-agent/commit/e74a7b01849ca59e11f3f53709be66727dd8c7be))
* implement scouting phase retry mechanism with transient failure handling ([5a076a8](https://github.com/CyanAutomation/kaseki-agent/commit/5a076a848690beff757a3b481f65ea19828f8ab6))
* simplify UI by setting default values for Git ref, timeout, and publish mode ([f0eb598](https://github.com/CyanAutomation/kaseki-agent/commit/f0eb5982bf4cff24b4b856780e7335b9a08e4bef))

## [1.49.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.49.0...v1.49.1) (2026-05-25)


### Bug Fixes

* Preserve terminal job state during persistence merge ([#389](https://github.com/CyanAutomation/kaseki-agent/issues/389)) ([750c8a9](https://github.com/CyanAutomation/kaseki-agent/commit/750c8a9ec53ff5cf69378c083ea59e87459d88b0))

# [1.49.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.48.0...v1.49.0) (2026-05-25)


### Features

* Improve Kaseki concurrency admission and UI ([#382](https://github.com/CyanAutomation/kaseki-agent/issues/382)) ([655d03e](https://github.com/CyanAutomation/kaseki-agent/commit/655d03e05ccfed5e1595ce7d5b63803e59232938))

# [1.48.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.47.0...v1.48.0) (2026-05-24)


### Bug Fixes

* Clean up formatting in isRetryableStatus function and update message string in requestOwnerReview ([ceedb94](https://github.com/CyanAutomation/kaseki-agent/commit/ceedb94bf3858451472ac9eefdcd48d28600fcf9))


### Features

* Add requestOwnerReview functionality with comprehensive tests ([479cb28](https://github.com/CyanAutomation/kaseki-agent/commit/479cb28ed507ccb7e52563e3d9bb2ec46bbe507f))

# [1.47.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.46.0...v1.47.0) (2026-05-24)


### Features

* add goal check pi agent loop ([20fa5e0](https://github.com/CyanAutomation/kaseki-agent/commit/20fa5e03c76f71ff437368ce935c9a4622833ecc))
* Add goal check Pi agent loop ([#381](https://github.com/CyanAutomation/kaseki-agent/issues/381)) ([40412be](https://github.com/CyanAutomation/kaseki-agent/commit/40412beab645f806612841ea731f334fc897fd18))

# [1.46.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.45.0...v1.46.0) (2026-05-24)


### Features

* Add case for merging validation patterns with empty user patterns ([9e884ec](https://github.com/CyanAutomation/kaseki-agent/commit/9e884ec9f9c333f1ce4586bf39b97011e5f7407b))

# [1.45.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.44.0...v1.45.0) (2026-05-24)


### Bug Fixes

* adjust regex in scouting API test to match requestBody function formatting ([072c496](https://github.com/CyanAutomation/kaseki-agent/commit/072c496c21a8ad4fd226bf74a9271caeba5f5c0a))


### Features

* add comprehensive tests for scouting agent allowlist control functionality ([1008048](https://github.com/CyanAutomation/kaseki-agent/commit/10080489bd66044d7db8f9d2aee45081eff8aea6))
* add detailed validation tests for OpenAPI components and paths ([39ad021](https://github.com/CyanAutomation/kaseki-agent/commit/39ad0214ebb86123a90e09e14cd75f2dfe0d2bd7))
* implement scouting agent and automatic allowlist control for enhanced file modification management ([9b8d484](https://github.com/CyanAutomation/kaseki-agent/commit/9b8d484212d0fd7e15cefa82f192f78ebc08bb2b))

# [1.44.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.43.1...v1.44.0) (2026-05-24)


### Bug Fixes

* adjust regex in test to match requestBody function formatting ([20b852c](https://github.com/CyanAutomation/kaseki-agent/commit/20b852c535dc22a82c3a442dd2cf2885da50f5f6))
* update version to 1.43.1 and enhance header status in web UI ([8fc0de4](https://github.com/CyanAutomation/kaseki-agent/commit/8fc0de4b604ea793fc426cbf1c6c95a5269142b2))


### Features

* add API bearer token input and session storage handling in web UI ([c22b649](https://github.com/CyanAutomation/kaseki-agent/commit/c22b6490bf73ebc026e5eb738e622940905816e1))

## [1.43.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.43.0...v1.43.1) (2026-05-24)


### Bug Fixes

* Add KASEKI_VALIDATION_COMMANDS to environment variable list in RunCommand tests ([04a5911](https://github.com/CyanAutomation/kaseki-agent/commit/04a5911040ec5f97435686526eaecb8847ce7805))

# [1.43.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.42.0...v1.43.0) (2026-05-23)


### Features

* improve Kaseki web console usability ([f2ccf57](https://github.com/CyanAutomation/kaseki-agent/commit/f2ccf57d8019bc726c5632327e9dd207fdce53f7))

# [1.42.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.41.0...v1.42.0) (2026-05-23)


### Features

* Update API version to 1.41.0 and enhance web interface with scouting options ([4b641da](https://github.com/CyanAutomation/kaseki-agent/commit/4b641daec6c3bfa174513eaa732d537d7825cb8b))

# [1.41.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.40.2...v1.41.0) (2026-05-23)


### Bug Fixes

* Correct regex pattern for requestBody function match in tests ([fa63ba4](https://github.com/CyanAutomation/kaseki-agent/commit/fa63ba4fec81cd205a404114ca64609bdd3873fd))


### Features

* Update Kaseki Agent API version to 1.40.2 and enhance web interface with health check tabs ([2c84961](https://github.com/CyanAutomation/kaseki-agent/commit/2c8496147dea618ffd0225eb49bf1ac63f07f186))

## [1.40.2](https://github.com/CyanAutomation/kaseki-agent/compare/v1.40.1...v1.40.2) (2026-05-23)


### Bug Fixes

* Update Node.js setup action to version 6 in publish workflow ([40d1db4](https://github.com/CyanAutomation/kaseki-agent/commit/40d1db4ecd202bfd8b494e4799db177fbd866e83))

## [1.40.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.40.0...v1.40.1) (2026-05-23)


### Bug Fixes

* Enhance job recency comparison logic to prioritize terminal job states ([a13f7d2](https://github.com/CyanAutomation/kaseki-agent/commit/a13f7d2ace96c5fee18d5791d4a0e7143ee0053f))
* Refactor job persistence tests and improve lock release logic ([9feb8e3](https://github.com/CyanAutomation/kaseki-agent/commit/9feb8e3ef8bf189a992ab5c4b56fe22efdc00691))

# [1.40.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.39.0...v1.40.0) (2026-05-22)


### Bug Fixes

* Adjust router mounting order to resolve precedence conflicts ([6dfe950](https://github.com/CyanAutomation/kaseki-agent/commit/6dfe9500f379cfa64dc5a79fb8f1c2cd1c98f8a6))


### Features

* Add Traefik configuration for dynamic routing and automatic HTTPS management ([63fb107](https://github.com/CyanAutomation/kaseki-agent/commit/63fb1071f51da25150a433a4db4974ced4f42ebf))

# [1.39.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.38.0...v1.39.0) (2026-05-22)


### Features

* add pi scouting phase ([de57586](https://github.com/CyanAutomation/kaseki-agent/commit/de575864211ab795e0ae3f8cfec6e54106ce035d))
* add scouting artifact path to repo memory test script ([ccfd206](https://github.com/CyanAutomation/kaseki-agent/commit/ccfd206324267c8e2350851e8273ba9e4fdd3e3a))

# [1.38.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.37.1...v1.38.0) (2026-05-22)


### Bug Fixes

* add shellcheck directives and improve error handling in test scripts ([6df31c9](https://github.com/CyanAutomation/kaseki-agent/commit/6df31c9e9609f311c7188e633d6327e2f7530dd5))
* set default KASEKI_STREAM_PROGRESS to 1 in docker-compose.yml ([41af905](https://github.com/CyanAutomation/kaseki-agent/commit/41af9055a2e2f7759e6ff18184e982a141c70a4a))
* update KASEKI_API_LOG_LEVEL to warn in docker-compose.yml ([365ca0e](https://github.com/CyanAutomation/kaseki-agent/commit/365ca0ea444947a5f05add49628fda683e236d73))
* update KASEKI_VALIDATION_COMMANDS to remove build step in documentation and scripts ([ed30e19](https://github.com/CyanAutomation/kaseki-agent/commit/ed30e1943af6a542e71e8a892a9002debe8ce148))


### Features

* add KASEKI_STREAM_PROGRESS environment variable to docker-compose.yml ([862d02d](https://github.com/CyanAutomation/kaseki-agent/commit/862d02d2ea6bf14b340e41b9d3f208c242bfb016))

## [1.37.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.37.0...v1.37.1) (2026-05-22)


### Bug Fixes

* Stabilize checkout freshness rev-parse failure tests ([#352](https://github.com/CyanAutomation/kaseki-agent/issues/352)) ([af61d8c](https://github.com/CyanAutomation/kaseki-agent/commit/af61d8c6121519df4baf174c8cf9be6b2e6bd037))

# [1.37.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.36.11...v1.37.0) (2026-05-21)


### Features

* Add functions to manage git safe.directory and fix checkout permissions ([fa61072](https://github.com/CyanAutomation/kaseki-agent/commit/fa6107226a7bf383f7575f3baecb17c9a17f8471))

## [1.36.11](https://github.com/CyanAutomation/kaseki-agent/compare/v1.36.10...v1.36.11) (2026-05-21)


### Bug Fixes

* checkout probe identity-switching logic issues ([#343](https://github.com/CyanAutomation/kaseki-agent/issues/343)) ([c08ac8e](https://github.com/CyanAutomation/kaseki-agent/commit/c08ac8ecca05b17789bfb162603bab157e3ea5cd))

## [1.36.10](https://github.com/CyanAutomation/kaseki-agent/compare/v1.36.9...v1.36.10) (2026-05-21)


### Bug Fixes

* update error message for git repository check and add build/test script ([b37a171](https://github.com/CyanAutomation/kaseki-agent/commit/b37a171ead259e2da7e96bd7f7a464ead02b367a))

## [1.36.9](https://github.com/CyanAutomation/kaseki-agent/compare/v1.36.8...v1.36.9) (2026-05-20)


### Bug Fixes

* add semantic checks for timeoutSeconds and enum constraints in schema tests ([9e5f997](https://github.com/CyanAutomation/kaseki-agent/commit/9e5f997e2201a15a28bfdacda04beef4b1e8da73))
* block stale controller checkouts before publishing ([8c47566](https://github.com/CyanAutomation/kaseki-agent/commit/8c47566af227fa8120067501f9f7dabc00f79a15))
* block stale controller checkouts before publishing ([#338](https://github.com/CyanAutomation/kaseki-agent/issues/338)) ([b916f7f](https://github.com/CyanAutomation/kaseki-agent/commit/b916f7fa668cc04eef39dcc93be61115e9684f2c))

## [1.36.8](https://github.com/CyanAutomation/kaseki-agent/compare/v1.36.7...v1.36.8) (2026-05-20)


### Bug Fixes

* export KASEKI_SECRETS_DIR for preflight helper script ([8c8cb71](https://github.com/CyanAutomation/kaseki-agent/commit/8c8cb7142289b36b4d9d9d87cf8d0602cd45cd50))

## [1.36.7](https://github.com/CyanAutomation/kaseki-agent/compare/v1.36.6...v1.36.7) (2026-05-20)


### Bug Fixes

* update default timeout and max diff bytes in configuration ([5a73dd1](https://github.com/CyanAutomation/kaseki-agent/commit/5a73dd19b2a8e191f06764e40cd705aa5aba329b))

## [1.36.6](https://github.com/CyanAutomation/kaseki-agent/compare/v1.36.5...v1.36.6) (2026-05-20)


### Bug Fixes

* increase timeout and max_diff_bytes in default configuration ([8b76001](https://github.com/CyanAutomation/kaseki-agent/commit/8b76001aa248c5404c21df6df794ff16aa3f6cf2))

## [1.36.5](https://github.com/CyanAutomation/kaseki-agent/compare/v1.36.4...v1.36.5) (2026-05-20)


### Bug Fixes

* add backward compatibility for legacy secret file path in resolve_github_secret_file ([fe06498](https://github.com/CyanAutomation/kaseki-agent/commit/fe06498cc2ae2cd0719d004a9633bb5176a9f539))

## [1.36.4](https://github.com/CyanAutomation/kaseki-agent/compare/v1.36.3...v1.36.4) (2026-05-20)


### Bug Fixes

* add Service Integration description for service bootstrapping ([8fe6108](https://github.com/CyanAutomation/kaseki-agent/commit/8fe6108405089269aca7e5c47aaa79f9c263a2f1))
* enable external code search ingestion for GitHub Copilot ([b2c0d5d](https://github.com/CyanAutomation/kaseki-agent/commit/b2c0d5d652aa7ef5092df45590883796433d6adf))
* remove redundant line in OpenAPI Schema Builders tests ([55ddba5](https://github.com/CyanAutomation/kaseki-agent/commit/55ddba52483d6cf7b423c9dcc57ff42044d25f78))

## [1.36.3](https://github.com/CyanAutomation/kaseki-agent/compare/v1.36.2...v1.36.3) (2026-05-20)


### Bug Fixes

* add KASEKI_API_KEYS environment variable to docker-compose ([0f0d8fa](https://github.com/CyanAutomation/kaseki-agent/commit/0f0d8fae57f3c5591fa6d3d8dc51314eb660b937))
* add KASEKI_API_KEYS environment variable to docker-compose ([710bf21](https://github.com/CyanAutomation/kaseki-agent/commit/710bf21bd95102ad5b88acbce5d73880edbee0bc))
* add KASEKI_API_KEYS environment variable to docker-compose ([b4966de](https://github.com/CyanAutomation/kaseki-agent/commit/b4966de517db4fa381222a645d36c31ec01901fb))
* simplify host secret mounts ([3e2870d](https://github.com/CyanAutomation/kaseki-agent/commit/3e2870d98a8e58bbe9ea7721957e85bd1a9f9278))
* update secrets configuration in docker-compose and QUICK_START documentation ([b9f6421](https://github.com/CyanAutomation/kaseki-agent/commit/b9f6421d1030c6cea94beb145df1d8d6c0baf20c))

## [1.36.2](https://github.com/CyanAutomation/kaseki-agent/compare/v1.36.1...v1.36.2) (2026-05-19)


### Bug Fixes

* update CHANGELOG formatting to support multiple heading styles ([2af79ac](https://github.com/CyanAutomation/kaseki-agent/commit/2af79ac3fad1b2006ceabf1beae39f584da75fa1))

## [1.36.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.36.0...v1.36.1) (2026-05-19)

### Bug Fixes

* code structure for improved readability and maintainability ([70d2a79](https://github.com/CyanAutomation/kaseki-agent/commit/70d2a79fe61fa98b64508248dafea28c7904b075))

# [1.36.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.35.0...v1.36.0) (2026-05-19)

### Features

* Add retry logic for CHANGELOG check to handle workflow_run race condition ([10b06bf](https://github.com/CyanAutomation/kaseki-agent/commit/10b06bfad52c8369b4be1322521b891c8f384623))

# [1.35.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.34.3...v1.35.0) (2026-05-19)

### Bug Fixes

* Clean up whitespace in job scheduler and secrets reader files for consistency ([9f380af](https://github.com/CyanAutomation/kaseki-agent/commit/9f380af030d917808df9ef878bcbb53d1d35f593))

### Features

* Update GitHub App secret handling and paths for improved compatibility ([f6150f8](https://github.com/CyanAutomation/kaseki-agent/commit/f6150f81a2366bd56716f67179db9b88d208fb9f))
* Update GitHub App secret handling and paths for improved compatibility ([442097f](https://github.com/CyanAutomation/kaseki-agent/commit/442097ff957df2a4c2880fce7589c866815914f6))

## [1.34.3](https://github.com/CyanAutomation/kaseki-agent/compare/v1.34.2...v1.34.3) (2026-05-19)

### Bug Fixes

* Update API router middleware to skip auth for health check endpoints only ([f4a84d3](https://github.com/CyanAutomation/kaseki-agent/commit/f4a84d3c7a3c5575bc92bcd8a90aa28a0cc81e97))

## [1.34.2](https://github.com/CyanAutomation/kaseki-agent/compare/v1.34.1...v1.34.2) (2026-05-19)

### Bug Fixes

* Improve environment variable handling in host secrets tests ([ace1c80](https://github.com/CyanAutomation/kaseki-agent/commit/ace1c80aa7d0573c6a06baada44be1e4acbf36ea))
* QuickstartCommand for improved structure and error handling; update .fallowrc.json entries and remove unused ArtifactFileInfo interface ([ae10369](https://github.com/CyanAutomation/kaseki-agent/commit/ae1036927d4eb60eb658a42fc12e06034fc19035))

## [1.34.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.34.0...v1.34.1) (2026-05-18)

### Bug Fixes

* changelog formatting ([3b34f18](https://github.com/CyanAutomation/kaseki-agent/commit/3b34f1828e7d72f5ff470b1710f312d6ac60c604))

## [Unreleased]

### Bug Fixes

* **deps**: upgrade Jest to v30, ts-jest to v29.4.9, and add npm overrides to eliminate deprecated glob@7 and inflight@1.0.6 warnings from Docker build logs
* **deps**: upgrade glob to v13.0.6 via npm overrides to resolve glob@10.5.0 deprecation warning in development builds

## [1.34.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.33.1...v1.34.0) (2026-05-18)

### Bug Fixes

* streamline OpenAPI test assertion helpers and remove unused functions ([dc8ccec](https://github.com/CyanAutomation/kaseki-agent/commit/dc8ccec967ac0cc4bc1befdb70d8950a879ed022))

### Features

* implement AgentsBootstrapper, ContainerLauncher, SecretResolver, and EnvironmentValidator for improved setup and management ([571b6ba](https://github.com/CyanAutomation/kaseki-agent/commit/571b6ba2884e099c773f666fa6413d6f8ad7c096))

## [1.33.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.33.0...v1.33.1) (2026-05-17)

### Bug Fixes

* correct symlink creation for kaseki-init-container.sh in Dockerfile ([52bf8b7](https://github.com/CyanAutomation/kaseki-agent/commit/52bf8b7cf4e093e1c9623fee987a70ab115d954d))

# [1.33.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.32.0...v1.33.0) (2026-05-17)

### Bug Fixes

* update regex patterns for UUID validation and improve secret path resolution ([b1e1d57](https://github.com/CyanAutomation/kaseki-agent/commit/b1e1d570a00b4018adcab1326ac08a90694a449c))
* update release presets to use Angular style and remove unused dependencies ([4d1968e](https://github.com/CyanAutomation/kaseki-agent/commit/4d1968eb715a21913bf185fd688a95df5e7aea19))

### Features

* Implement unified secrets setup and management ([1f01043](https://github.com/CyanAutomation/kaseki-agent/commit/1f01043e370b7ede009fd2953ad7859d06978f54))

## [1.32.5](https://github.com/CyanAutomation/kaseki-agent/releases/tag/v1.32.5) (2026-05-17)

### ⚠️ BREAKING CHANGES

**Public API Client (`KasekiApiClient`):**
The following public methods have been removed from `src/kaseki-api-client.ts`. These methods were identified as unused by static analysis and are not called by any clients or tests:

* `submit()` - Use direct HTTP POST to `/api/runs` instead
* `cancel(runId)` - Use direct HTTP POST to `/api/runs/{id}/cancel` instead
* `getProgress(runId)` - Use `getStatus(runId)` instead
* `getAnalysis(runId)` - Use direct HTTP GET to `/api/runs/{id}/analysis` instead
* `getLog(runId, logType)` - Use direct HTTP GET to `/api/results/{id}/{file}` instead
* `getArtifact(runId, artifactType)` - Use direct HTTP GET to `/api/results/{id}/{file}` instead
* `listRuns()` - Use direct HTTP GET to `/api/runs` instead
* `waitForCompletion(runId, timeoutSeconds)` - Use `getStatus()` in a polling loop with timeout instead
* `getHealth()` - Use direct HTTP GET to `/health` instead

**Configuration Management (`ConfigManager`):**
The following methods have been removed from `src/config/ConfigManager.ts`:

* `getConfig()` - Use `get(key)` for specific configuration values instead
* `save()` - Configuration is loaded at initialization; modifying config at runtime is not supported
* `getConfigFilePath()` - Configuration file paths are internal implementation details
* `reset()` - Configuration resets are not supported; recreate the manager instance instead

**CLI Utilities:**

* `ConfigManager.getConfigFilePath()` was removed; config file paths are now internal
* `IdempotencyStore.getSize()` was removed; use `has()` to check for existence instead
* `SecretsManager.getRecommendedStore()` was removed; store selection is automatic
* `KasekiCLI.getCommands()` was removed; commands are registered internally

**Migration Guide:**
Users calling removed methods should:

1. **For `KasekiApiClient` methods:** Use the HTTP endpoints directly via `validate()` and `getStatus()`, or migrate to direct HTTP calls
2. **For `ConfigManager` methods:** Access config values via `get(key)` or use environment variables for one-time configuration
3. **For CLI utilities:** These are internal APIs; use the CLI commands directly instead of programmatic access

### Code Quality

* **Static Analysis Cleanup:** Removed 20 unused methods identified by fallow static analysis tool
  * 9 from `KasekiApiClient` (public API client)
  * 4 from `ConfigManager` (configuration management)
  * 1 from `KasekiCLI` (command router)
  * 1 from `IdempotencyStore` (cache utilities)
  * 1 from `SecretsManager` (secrets management)
  * 4 `LocalKasekiApiClient` methods were initially flagged but are actively used by CLI commands and were retained

* **Consolidated Test Patterns:** Reduced test duplication in `openapi-spec-generator.test.ts` by consolidating similar test patterns using shared test helpers

### Details

* All 20 removed methods had no callers in the codebase (verified via `grep` and test coverage)
* Build passes with 0 TypeScript errors
* All 790 tests continue to pass
* Fallow dead-code detection reports ~31 fewer unused members than before

## [1.32.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.31.0...v1.32.0) (2026-05-16)

### Features

* add checks for file readability and directory traversability by UID/GID on read-only mounts ([a062a2f](https://github.com/CyanAutomation/kaseki-agent/commit/a062a2f0f3ccd9b919c516c62f1a1b0eb6489dbd))

## [1.31.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.30.2...v1.31.0) (2026-05-16)

### Features

* kaseki-agent quickstart — one-command production setup ([e2e7cda](https://github.com/CyanAutomation/kaseki-agent/commit/e2e7cda311ad8a1ba06f864f9facd2764e120ea6))
* kaseki-agent quickstart (one-command setup) ([#317](https://github.com/CyanAutomation/kaseki-agent/issues/317)) ([bd638f7](https://github.com/CyanAutomation/kaseki-agent/commit/bd638f7967489e852a3c79ddcdbe9957701ba12b))

### Bug Fixes

* correct path for host state file in preflight configuration test ([601b8a2](https://github.com/CyanAutomation/kaseki-agent/commit/601b8a2f51f32eca7916355a46a3f27404965c3d))
* doctor correctness — JSON purity, NaN disk space, secret discovery, deprecated command ref ([986d5ee](https://github.com/CyanAutomation/kaseki-agent/commit/986d5ee70bb6a48f0a4ad6ef2014d027433cae86))
* doctor correctness (NaN, JSON purity, secret discovery) ([#315](https://github.com/CyanAutomation/kaseki-agent/issues/315)) ([f149c37](https://github.com/CyanAutomation/kaseki-agent/commit/f149c378f50fd5090c130691d0034643ac8fd41a))
* harden doctor checks (JSON purity, command-injection hardening, auth label sanitization) ([#319](https://github.com/CyanAutomation/kaseki-agent/issues/319)) ([a9d4d42](https://github.com/CyanAutomation/kaseki-agent/commit/a9d4d42982399c231ab6611194bcb976fa28c632))
* harden doctor child processes ([b76a16a](https://github.com/CyanAutomation/kaseki-agent/commit/b76a16ab6be170205f3f3923beaacc0d3936d604))
* healthcheck validates /ready response body not just HTTP status ([12df4e3](https://github.com/CyanAutomation/kaseki-agent/commit/12df4e378f33c8a2c8b4708534e809fa766dc4bf))
* host preflight hang + visibility + config pollution ([#316](https://github.com/CyanAutomation/kaseki-agent/issues/316)) ([3018f2b](https://github.com/CyanAutomation/kaseki-agent/commit/3018f2b75d6744899d267238e9df0f64b77015f5))
* host preflight timeout, host visible in --help, init writes to ~/.kaseki/ ([6ffda50](https://github.com/CyanAutomation/kaseki-agent/commit/6ffda507af5ad47e5abff3ca13bb3dcb66c60c8f))

## [1.30.2](https://github.com/CyanAutomation/kaseki-agent/compare/v1.30.1...v1.30.2) (2026-05-16)

### Bug Fixes

* update KASEKI_SECRETS_DIR path in docker-compose and adjust related tests ([d3e192b](https://github.com/CyanAutomation/kaseki-agent/commit/d3e192bbd988d0b0c6f2c6fdcf694ee3f01cbaa8))
* update KASEKI_SECRETS_DIR path in docker-compose and related tests ([7c005d9](https://github.com/CyanAutomation/kaseki-agent/commit/7c005d9304f69486086e36ded68c9f482727031a))

## [1.30.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.30.0...v1.30.1) (2026-05-16)

### Bug Fixes

* remove local keyword for secret file variables in kaseki-agent.sh for consistency ([b8cb243](https://github.com/CyanAutomation/kaseki-agent/commit/b8cb243f3b47a90061b3ba1c62da034d193da63b))
* update KASEKI_SECRETS_DIR path in docker-compose configuration for consistency ([d20f48f](https://github.com/CyanAutomation/kaseki-agent/commit/d20f48fc9778d7139ad3c19be2ba70b4ce9207b0))

## [1.30.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.29.1...v1.30.0) (2026-05-16)

### Features

* add lint output file for JavaScript linting results ([e2bd637](https://github.com/CyanAutomation/kaseki-agent/commit/e2bd637f1412cc029bea3d96979b5d637a39bc1f))
* add npm verification script with exponential backoff for package publication ([3b8d078](https://github.com/CyanAutomation/kaseki-agent/commit/3b8d0781073a34892c3263980d7abaffaa74aee7))

### Bug Fixes

* improve variable export in setup script and enhance error handling in npm verification ([351255a](https://github.com/CyanAutomation/kaseki-agent/commit/351255aba1f1128bb69be5f6be34ab644c56d4f5))
* update GitHub App secret file paths for improved readability and error handling ([7d740eb](https://github.com/CyanAutomation/kaseki-agent/commit/7d740eb8340af11942fe3db5c97a41ebadb2385d))
* update secrets directory paths in docker-compose configuration ([11f10f0](https://github.com/CyanAutomation/kaseki-agent/commit/11f10f0ed19c80f978d5c8408c4219e5592dd9da))

## [1.29.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.29.0...v1.29.1) (2026-05-16)

### Bug Fixes

* update remediation message for preflight diagnostics ([83eb06a](https://github.com/CyanAutomation/kaseki-agent/commit/83eb06a51ba5cfc49fd3a126ae309f9c67799a09))

## [1.29.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.28.0...v1.29.0) (2026-05-15)

### Features

* add init container for automatic /agents directory permission management ([081cc05](https://github.com/CyanAutomation/kaseki-agent/commit/081cc05357f30d0f602b5be411f1927c5606d9f9))

## [1.28.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.27.5...v1.28.0) (2026-05-15)

### Features

* add --force option to InitCommand and enhance SetupWizard with permission checks ([76a3397](https://github.com/CyanAutomation/kaseki-agent/commit/76a339797528ebc960f6e7a0ada04e56960b6c5a))
* add shared OpenAPI test assertion helpers to simplify tests ([2a91b27](https://github.com/CyanAutomation/kaseki-agent/commit/2a91b273b8d6f5a6926b8431432095e223bab26b))
* enhance Docker setup documentation and add pre-flight validation script ([b4b37fd](https://github.com/CyanAutomation/kaseki-agent/commit/b4b37fd99e8aa653b4c369fcb56fa06a68a5f211))

### Bug Fixes

* remove unnecessary blank lines in runTemplateDoctor and buildTemplateHealthStatus functions ([3ba4efc](https://github.com/CyanAutomation/kaseki-agent/commit/3ba4efc1dd4acaa60f85da750cf981fa3d8a1f62))

## [1.27.5](https://github.com/CyanAutomation/kaseki-agent/compare/v1.27.4...v1.27.5) (2026-05-14)

### Bug Fixes

* formatting of Docker usage section in README ([df54e18](https://github.com/CyanAutomation/kaseki-agent/commit/df54e183cbef6b7fce6a60bdec488cf6fac29476))

## [1.27.4](https://github.com/CyanAutomation/kaseki-agent/compare/v1.27.3...v1.27.4) (2026-05-14)

### Bug Fixes

* enhance Node version validation in SetupOrchestrator tests and mock assertSupportedNodeVersion ([9613538](https://github.com/CyanAutomation/kaseki-agent/commit/96135384623124e9767c4a040dc9e887b69d2191))

## [1.27.3](https://github.com/CyanAutomation/kaseki-agent/compare/v1.27.2...v1.27.3) (2026-05-14)

### Bug Fixes

* update test scripts to use temporary directories for isolation and improve error handling ([64f389c](https://github.com/CyanAutomation/kaseki-agent/commit/64f389ca7d6c59d9ef7fdab3c91feac6effe043e))

## [1.27.2](https://github.com/CyanAutomation/kaseki-agent/compare/v1.27.1...v1.27.2) (2026-05-14)

### Bug Fixes

* remove unnecessary blank lines in integration tests for improved readability ([24ed80a](https://github.com/CyanAutomation/kaseki-agent/commit/24ed80ac4b009dab1ba5e9eb6fa464897f5733f0))

## [1.27.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.27.0...v1.27.1) (2026-05-14)

### Bug Fixes

* update result file paths to use temporary directory for test isolation ([113b191](https://github.com/CyanAutomation/kaseki-agent/commit/113b191b3e388cad3362f5b3495b5628908b7b43))

## [1.27.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.26.1...v1.27.0) (2026-05-14)

### Features

* Add .fallowrc.json configuration and update .gitignore to include .fallow/ ([f06c45a](https://github.com/CyanAutomation/kaseki-agent/commit/f06c45ae7a1908f6b9e9e6ebdd81f9d3e48c4d70))
* Add conventional-changelog-conventionalcommits dependency for automated changelog generation ([63fe9fa](https://github.com/CyanAutomation/kaseki-agent/commit/63fe9fa5abb8d9f57f1311bb1ebe6738ce172783))
* add OpenAPI path and schema builders for Kaseki Agent API ([8fb517c](https://github.com/CyanAutomation/kaseki-agent/commit/8fb517c77ff5507686ea74942ce6e56a80e104c6))
* add validation for GitHub client ID file naming and provide suggestions in ConfigManager and DoctorCommand ([8cd5758](https://github.com/CyanAutomation/kaseki-agent/commit/8cd575850d55012e792116eddb7a7e30d6cf50e6))
* Complete setup simplification with auto-initialization, unified commands, and migration guide ([a7441d1](https://github.com/CyanAutomation/kaseki-agent/commit/a7441d17a0ff4836f303fb9c22005b95c3d82e09))
* Export class and function declarations for DockerManager, KasekiApiClient, SecretValueCache, SetupWizard, and test utilities ([12f3f27](https://github.com/CyanAutomation/kaseki-agent/commit/12f3f27ca123e4fd29936b25a1afe1f186d00fb5))
* export classes and functions for improved accessibility in DockerManager, SecretValueCache, and test utilities ([3015d7c](https://github.com/CyanAutomation/kaseki-agent/commit/3015d7c49a3e409245e19008349e2df128fb745f))
* implement OpenAPI component builders for security schemes, tags, info, and servers ([f25a97f](https://github.com/CyanAutomation/kaseki-agent/commit/f25a97f6055411253490815475e6582a5b67bb60))
* Increase KASEKI_AGENT_TIMEOUT_SECONDS from 3600 to 7200 for longer agent invocations ([43459ad](https://github.com/CyanAutomation/kaseki-agent/commit/43459adf3004496dc74a9b39f356c0aecb49e91a))
* Introduce unified setup wizard for kaseki-agent ([761c177](https://github.com/CyanAutomation/kaseki-agent/commit/761c1772ea1ac11abd93bfa16d3bf64f1add006d))
* Simplify setup process with unified init wizard and updated documentation ([184365c](https://github.com/CyanAutomation/kaseki-agent/commit/184365c4b0665031b812b79d02f8205f3badb3cc))

## [1.26.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.26.0...v1.26.1) (2026-05-13)

### Bug Fixes

* enhance validation command diagnostics and improve summary file handling ([c0dda19](https://github.com/CyanAutomation/kaseki-agent/commit/c0dda19efd150a284037f01408187c1a2c8a49c5))
* update shellcheck disables and correct string quotes in token helper function ([5e52003](https://github.com/CyanAutomation/kaseki-agent/commit/5e52003c55832434f86b60600351bb42d628c280))

## [1.26.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.25.4...v1.26.0) (2026-05-13)

### Features

* add bootstrap validation and error handling to API service and scripts ([386cfb7](https://github.com/CyanAutomation/kaseki-agent/commit/386cfb742304104ad05c96196f9bf70ea3958599))

### Bug Fixes

* update string quotes for consistency in error messages and environment variable setup ([59b62c9](https://github.com/CyanAutomation/kaseki-agent/commit/59b62c989a35b4602cc38df77f2d53e5fe648224))
* update trap syntax for temporary file cleanup and add shellcheck disables for clarity ([261504d](https://github.com/CyanAutomation/kaseki-agent/commit/261504d004707f59d66d6220dcfb390ebea2f801))

## [1.25.4](https://github.com/CyanAutomation/kaseki-agent/compare/v1.25.3...v1.25.4) (2026-05-13)

### Bug Fixes

* collapse long PR file lists ([32582fb](https://github.com/CyanAutomation/kaseki-agent/commit/32582fbb9acc658fc33ba1ab4031fdc834bf485c))
* collapse long PR file lists ([#278](https://github.com/CyanAutomation/kaseki-agent/issues/278)) ([37b6455](https://github.com/CyanAutomation/kaseki-agent/commit/37b6455cc8b727560545eb063060c698042ee69b))

## [1.25.3](https://github.com/CyanAutomation/kaseki-agent/compare/v1.25.2...v1.25.3) (2026-05-13)

### Bug Fixes

* derive PR titles with instance suffix ([b868074](https://github.com/CyanAutomation/kaseki-agent/commit/b868074c6215d693abe824489239a1c9af5e9e26))

## [1.25.2](https://github.com/CyanAutomation/kaseki-agent/compare/v1.25.1...v1.25.2) (2026-05-12)

### Bug Fixes

* normalize wrapped github app private keys ([489ccca](https://github.com/CyanAutomation/kaseki-agent/commit/489cccadf354651fd965f1c3faed873e7131d46f))
* normalize wrapped GitHub App private keys ([#249](https://github.com/CyanAutomation/kaseki-agent/issues/249)) ([df54da9](https://github.com/CyanAutomation/kaseki-agent/commit/df54da9a384a7e75cb8018302f9cf3988dec2960))

## [1.25.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.25.0...v1.25.1) (2026-05-11)

### Bug Fixes

* update logging to use consistent string formatting in validation output filter ([f77778a](https://github.com/CyanAutomation/kaseki-agent/commit/f77778a15d8b470db602f33eece040a6dafba497))

## [1.25.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.24.6...v1.25.0) (2026-05-11)

### Features

* enhance validation logging with diagnostics and environment details ([3f4c3af](https://github.com/CyanAutomation/kaseki-agent/commit/3f4c3aff3e30c42e2f7a5bedaa4a5e679e9598a1))

## [1.24.6](https://github.com/CyanAutomation/kaseki-agent/compare/v1.24.5...v1.24.6) (2026-05-11)

### Bug Fixes

* ensure consistent exit code 0 for validation-output-filter to prevent pipeline failures ([5711e4b](https://github.com/CyanAutomation/kaseki-agent/commit/5711e4b0b8e911ed70cd722462890a19ea3a6c10))

## [1.24.5](https://github.com/CyanAutomation/kaseki-agent/compare/v1.24.4...v1.24.5) (2026-05-11)

### Bug Fixes

* retain devDependencies in Docker image for validation tools ([c2563d4](https://github.com/CyanAutomation/kaseki-agent/commit/c2563d438bbdd61339f84fb07f746a0d91054c59))

## [1.24.4](https://github.com/CyanAutomation/kaseki-agent/compare/v1.24.3...v1.24.4) (2026-05-11)

### Bug Fixes

* ensure filter always exits with code 0 and improve error handling ([a4314aa](https://github.com/CyanAutomation/kaseki-agent/commit/a4314aad134b66353c748ed75769d1b8d3ea2385))

## [1.24.3](https://github.com/CyanAutomation/kaseki-agent/compare/v1.24.2...v1.24.3) (2026-05-11)

### Bug Fixes

* add missing library files to /usr/local/bin/lib in Dockerfile ([e578cdb](https://github.com/CyanAutomation/kaseki-agent/commit/e578cdb0c0d136926086ac92a9bb2b3d08768c1a))

## [1.24.2](https://github.com/CyanAutomation/kaseki-agent/compare/v1.24.1...v1.24.2) (2026-05-11)

### Bug Fixes

* simplify error handling by removing unnecessary error variables in multiple files ([7a0ac82](https://github.com/CyanAutomation/kaseki-agent/commit/7a0ac828cda38913c4d4644a30ed56cb6e654337))

## [1.24.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.24.0...v1.24.1) (2026-05-11)

### Bug Fixes

* streamline build process by moving TypeScript build step before tests ([6d1922e](https://github.com/CyanAutomation/kaseki-agent/commit/6d1922e7079ab62b862a1cd20ea5035f491a534f))

## [1.24.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.23.0...v1.24.0) (2026-05-11)

### Features

* add validation tests for dist/lib packaging and module imports ([aaa3e76](https://github.com/CyanAutomation/kaseki-agent/commit/aaa3e76afb769e490170725cb69e83132a141760))

### Bug Fixes

* clean up code by removing unnecessary comments and improving error messages ([3765091](https://github.com/CyanAutomation/kaseki-agent/commit/3765091f384a1c5a7874ad19768608e668624b8f))

## [1.23.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.22.0...v1.23.0) (2026-05-11)

### Features

* enhance validation logging by capturing stderr output for diagnostics ([895a070](https://github.com/CyanAutomation/kaseki-agent/commit/895a07099b61aabcc48555f5974241ad4f49e8d7))

### Bug Fixes

* suppress shellcheck warnings for unused variables in test scripts ([aabae68](https://github.com/CyanAutomation/kaseki-agent/commit/aabae6830f37c0c1208ca93c67827f85d105fb91))

## [1.22.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.21.0...v1.22.0) (2026-05-11)

### Features

* integrate unused-imports ESLint plugin and enhance linting rules for better code quality ([023512b](https://github.com/CyanAutomation/kaseki-agent/commit/023512bd72246e7a15a16a0ce9b6f0380bb4ebe5))

### Bug Fixes

* update time check message format for clarity ([4ee5e81](https://github.com/CyanAutomation/kaseki-agent/commit/4ee5e818989ad1cde3364f4b4daca33e2b15188b))

## [1.21.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.20.0...v1.21.0) (2026-05-11)

### Features

* add SIGPIPE exit code handling and improve validation-output-filter error management ([200b0ab](https://github.com/CyanAutomation/kaseki-agent/commit/200b0ab824b1a69f1870186865de454d495d7fe7))

## [1.20.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.19.1...v1.20.0) (2026-05-11)

### Features

* add TypeScript configuration files for project setup ([598df34](https://github.com/CyanAutomation/kaseki-agent/commit/598df3481be09bab3f675c14f9b441d422f72b95))

## [1.19.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.19.0...v1.19.1) (2026-05-11)

### Bug Fixes

* correct printf syntax in validation summary output ([aa0bd87](https://github.com/CyanAutomation/kaseki-agent/commit/aa0bd87505aed58d565d19d7719e5bb4d84dab50))
* update message formatting in heartbeat and summary emission ([066bcc5](https://github.com/CyanAutomation/kaseki-agent/commit/066bcc554b236908e0466702da8455cb09894825))

## [1.19.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.18.0...v1.19.0) (2026-05-11)

### Features

* add validation output filter script and update usage instructions ([d301ee3](https://github.com/CyanAutomation/kaseki-agent/commit/d301ee39c984ff4b00022eb013342bee5a8be8c0))
* implement ToolBatchAggregator for efficient tool call batching and summary emission ([bdbf786](https://github.com/CyanAutomation/kaseki-agent/commit/bdbf78658285ee0ca4c987f38912456a48413e95))

### Bug Fixes

* remove unnecessary blank line before flushing tool batches ([cbf1987](https://github.com/CyanAutomation/kaseki-agent/commit/cbf198734079e2b1abaca0428ae67ea22e24b1c1))

## [1.18.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.17.0...v1.18.0) (2026-05-10)

### Features

* add KASEKI_REPO_MEMORY_ROOT and KASEKI_RESULTS_DIR variables for improved memory management ([3064dbe](https://github.com/CyanAutomation/kaseki-agent/commit/3064dbe22513de081b94073c01f76dd83ae182d6))

### Bug Fixes

* adjust errexit behavior in build_github_skip_reasons and related tests ([94e48aa](https://github.com/CyanAutomation/kaseki-agent/commit/94e48aa1807c3015b9ce43c83b5db30de2b9d1a7))

## [1.17.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.16.0...v1.17.0) (2026-05-10)

### Features

* add validation output filter and integrate with Docker logs ([fce28b7](https://github.com/CyanAutomation/kaseki-agent/commit/fce28b7066e158bbe7217daf797341ef460de936))

### Bug Fixes

* remove unnecessary blank line in processLine function ([1e8d906](https://github.com/CyanAutomation/kaseki-agent/commit/1e8d906faf28696d60804f80846c3419fa99cfb9))

## [1.16.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.15.1...v1.16.0) (2026-05-10)

### Features

* add diagnostic script and monitoring module for GitHub operations failures ([90c0ab2](https://github.com/CyanAutomation/kaseki-agent/commit/90c0ab2c6f1429823b30d242dcb68b722a924c32))
* enable GitHub App operations by default and add credential auto-detection ([3e21a40](https://github.com/CyanAutomation/kaseki-agent/commit/3e21a40c8e7c63530f6cde844105abc94b1a9642))

## [Unreleased]

### Features

* **GitHub App Operations Now Enabled by Default**: `GITHUB_APP_ENABLED` defaults to `1` (enabled) instead of `0` when credentials are available. GitHub operations (PR creation, branch push) are now attempted by default, improving user experience.
* **GitHub App Credential Auto-Detection**: Credentials are automatically discovered from multiple locations in priority order:
  * Environment variables (`GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_PRIVATE_KEY`)
  * Standard secret paths (`/agents/secrets/github_app_*`, `~/.secrets/github_app_*`)
  * Convenience auto-detect paths (`~/.ssh/github-app-private-key`, `$PWD/.github-app-secrets/private-key`, `/etc/kaseki-secrets/github_app_private_key`)
* **Graceful Credential Degradation**: When `KASEKI_PUBLISH_MODE=auto` (default), missing credentials no longer fail the run—GitHub operations are simply skipped. Strict modes (`branch`, `draft_pr`) still require credentials and fail with exit code 7.

### Documentation

* Added comprehensive GitHub App configuration guide to [docs/ENV_VARS.md](docs/ENV_VARS.md) with default behavior and auto-detection paths
* Updated [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) with credential setup examples and auto-detection priority order

### Backward Compatibility

* **No Breaking Changes**: Existing deployments continue to work. Explicit `GITHUB_APP_ENABLED=0` is always respected.
* **Automatic Enablement**: If GitHub App credentials are present and `KASEKI_PUBLISH_MODE ≠ "none"`, GitHub operations are now enabled automatically (previously required explicit configuration).

## [1.15.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.15.0...v1.15.1) (2026-05-10)

### Bug Fixes

* correct script copy location in Dockerfile for proper build context ([b573517](https://github.com/CyanAutomation/kaseki-agent/commit/b57351713d7f39aeaeda3b976eec6baf10df827e))

## [1.15.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.14.0...v1.15.0) (2026-05-10)

### Features

* add log suppression utilities for improved test output management ([f7830f1](https://github.com/CyanAutomation/kaseki-agent/commit/f7830f152ebb7f985435f8145524a9d2015bf31d))
* enhance GitHub API error handling with retry logic and validation tests ([ecce266](https://github.com/CyanAutomation/kaseki-agent/commit/ecce266cdf1a286227b5395c17af19dcdb663cce))

### Bug Fixes

* remove unnecessary whitespace in log suppression utility documentation ([4ffe0ea](https://github.com/CyanAutomation/kaseki-agent/commit/4ffe0ea666cc0090c619fddae65afa0e2a53f6e0))

## [1.14.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.13.1...v1.14.0) (2026-05-10)

### Features

* add OpenAPI 3.1 specification generation for Kaseki Agent API ([ab11ecc](https://github.com/CyanAutomation/kaseki-agent/commit/ab11ecca0d2f88e7f671e39687c95eec3b004fc0))

### Bug Fixes

* correct logging message format in OpenAPI spec generation script ([daf1a6c](https://github.com/CyanAutomation/kaseki-agent/commit/daf1a6c24f89def51d80cdabd4c9896f781f1f36))

## [1.13.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.13.0...v1.13.1) (2026-05-10)

### Bug Fixes

* improve secret scan logging and streamline artifact availability checks ([72e84cc](https://github.com/CyanAutomation/kaseki-agent/commit/72e84cce2681f7c01e6e374638c4a6a5649d27b4))

## [1.13.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.12.4...v1.13.0) (2026-05-10)

### Features

* enhance artifact management with comprehensive metadata and inline diagnostics ([c0f6231](https://github.com/CyanAutomation/kaseki-agent/commit/c0f62316856735e1bd3df8222e7c7b549da4d155))
* implement secret scan allowlist mechanism and update documentation ([0a64636](https://github.com/CyanAutomation/kaseki-agent/commit/0a64636f4db6488a47d113665555d4b523680ce7))

### Bug Fixes

* format changelog entries for consistency ([11cc6f2](https://github.com/CyanAutomation/kaseki-agent/commit/11cc6f28b61966c26942d0f7318639518ca6345f))

## [1.12.4](https://github.com/CyanAutomation/kaseki-agent/compare/v1.12.3...v1.12.4) (2026-05-10)

### Bug Fixes

* add ansi-colors.js to installation in Dockerfile ([54b3a06](https://github.com/CyanAutomation/kaseki-agent/commit/54b3a06532c9fce5a023e9e95caa54c579830a6d))

## [1.12.3](https://github.com/CyanAutomation/kaseki-agent/compare/v1.12.2...v1.12.3) (2026-05-10)

### Bug Fixes

* add installation of pi-progress-summarizer.js to Dockerfile ([230c644](https://github.com/CyanAutomation/kaseki-agent/commit/230c6443d4655dabfd43d641163c7787770f3c8a))

## [1.12.2](https://github.com/CyanAutomation/kaseki-agent/compare/v1.12.1...v1.12.2) (2026-05-10)

### Bug Fixes

* add installation of pi-progress-summarizer.js to Dockerfile ([1f35cea](https://github.com/CyanAutomation/kaseki-agent/commit/1f35cea0459862e29fa1516cfd0739c9b73a08b6))

## [1.12.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.12.0...v1.12.1) (2026-05-10)

### Bug Fixes

* increase KASEKI_AGENT_TIMEOUT_SECONDS to 3600 and update logging options in docker-compose.yml ([0ae9b1f](https://github.com/CyanAutomation/kaseki-agent/commit/0ae9b1fd43aea9b8bdf3592d87b64dd954cc1c61))
* update default values for KASEKI_API_MAX_CONCURRENT_RUNS, KASEKI_AGENT_TIMEOUT_SECONDS, and KASEKI_MAX_DIFF_BYTES in configuration files ([3419ec5](https://github.com/CyanAutomation/kaseki-agent/commit/3419ec590c3878e1795177b82937b3ea2779e222))

## [1.12.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.11.0...v1.12.0) (2026-05-10)

### Features

* add module import validation script and update build process ([f1613a0](https://github.com/CyanAutomation/kaseki-agent/commit/f1613a0ff5c68bd1a9f5d7b1b3bcb4a843cd4a20))
* implement host-based secrets management ([b118f57](https://github.com/CyanAutomation/kaseki-agent/commit/b118f57dc819a0a6592d294df8d66104f4a83185))

## [1.11.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.10.4...v1.11.0) (2026-05-09)

### Features

* add example environment configuration for Kaseki Agent API service ([ce35063](https://github.com/CyanAutomation/kaseki-agent/commit/ce3506323083015cb48a1f02f8189faefe947c79))

## [1.10.4](https://github.com/CyanAutomation/kaseki-agent/compare/v1.10.3...v1.10.4) (2026-05-09)

### Bug Fixes

* update user ID from 1000 to 10000 across Docker configurations and documentation for consistency ([4f40e21](https://github.com/CyanAutomation/kaseki-agent/commit/4f40e21278ebd0c082817c6e4653feee2e091e50))

## [1.10.3](https://github.com/CyanAutomation/kaseki-agent/compare/v1.10.2...v1.10.3) (2026-05-09)

### Bug Fixes

* update user ID from 10001 to 1000 across Docker configurations and documentation for consistency ([afae0c4](https://github.com/CyanAutomation/kaseki-agent/commit/afae0c476820a06523d9e196bbbabcf5a79503e0))

## [1.10.2](https://github.com/CyanAutomation/kaseki-agent/compare/v1.10.1...v1.10.2) (2026-05-09)

### Bug Fixes

* improve KASEKI_RESULTS_DIR creation error handling and ensure writable permissions ([d655e44](https://github.com/CyanAutomation/kaseki-agent/commit/d655e449acfbddf835e835e3c1b4624e71c18990))

## [1.10.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.10.0...v1.10.1) (2026-05-09)

### Bug Fixes

* enhance KASEKI_RESULTS_DIR creation with writable permissions and improved error messaging ([fa8f08d](https://github.com/CyanAutomation/kaseki-agent/commit/fa8f08defa177145eb4ffac8dd823df42b1be601))

## [1.10.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.9.0...v1.10.0) (2026-05-09)

### Features

* add comprehensive authentication setup guide and enhance DoctorCommand error handling ([085fd0e](https://github.com/CyanAutomation/kaseki-agent/commit/085fd0e46e26929c09142cf21ad788f8b4a40953))

## [1.9.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.8.1...v1.9.0) (2026-05-09)

### Features

* enhance Docker image checks and error handling in DoctorCommand and DockerManager ([31aa039](https://github.com/CyanAutomation/kaseki-agent/commit/31aa0391cf11bbdb4ddf5b3e5d0062981253f3da))

### Bug Fixes

* improve formatting and add troubleshooting steps in EXIT_CODES documentation ([7a9dce5](https://github.com/CyanAutomation/kaseki-agent/commit/7a9dce563aa22774e0433df50ec67c9de0ab250b))

## [1.8.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.8.0...v1.8.1) (2026-05-09)

### Bug Fixes

* correct formatting in DoctorCommand and RunCommand for better readability ([0bc498c](https://github.com/CyanAutomation/kaseki-agent/commit/0bc498cdef0f7b40dd6ee11b53af303c3108d2c5))

## [1.8.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.7.0...v1.8.0) (2026-05-09)

### Features

* add default values for repo URL, git ref, Docker image, and directories in RunCommand ([9e6c24c](https://github.com/CyanAutomation/kaseki-agent/commit/9e6c24c02d01ed1b436f3b750cacff0d747112fd))

## [1.7.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.6.0...v1.7.0) (2026-05-09)

### Features

* add authentication files validation to DoctorCommand and update RunCommand to check for required files ([266df6d](https://github.com/CyanAutomation/kaseki-agent/commit/266df6d282c666e47c45f8287857511a3359c2b9))

## [1.6.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.5.5...v1.6.0) (2026-05-09)

### Features

* integrate enquirer for interactive setup prompts ([e52baf9](https://github.com/CyanAutomation/kaseki-agent/commit/e52baf907207d6d519fdada19eb2282c5c0993fb))

## [1.5.5](https://github.com/CyanAutomation/kaseki-agent/compare/v1.5.4...v1.5.5) (2026-05-09)

### Bug Fixes

* add npm build step to publish-npm workflow to ensure dist/ is included in package ([aa47866](https://github.com/CyanAutomation/kaseki-agent/commit/aa4786690ca8a037c359681fd6eb487032643b4f))

## [1.5.4](https://github.com/CyanAutomation/kaseki-agent/compare/v1.5.3...v1.5.4) (2026-05-09)

### Bug Fixes

* add npm build step to release workflow to ensure dist/ is included in published package ([272b852](https://github.com/CyanAutomation/kaseki-agent/commit/272b852dcdd070ac0996df066aac393478a6ab49))

## [1.5.3](https://github.com/CyanAutomation/kaseki-agent/compare/v1.5.2...v1.5.3) (2026-05-09)

### Bug Fixes

* ensure dist/ rebuild with correct dynamic import .js extensions ([1092d1a](https://github.com/CyanAutomation/kaseki-agent/commit/1092d1ab8df48b8cb128771131aadb1a48afecf2))

## [1.5.3](https://github.com/CyanAutomation/kaseki-agent/compare/v1.5.2...v1.5.3) (2026-05-09)

### Bug Fixes

* synchronize the release version across package metadata, lockfile, and changelog
* configure semantic-release to update npm package metadata without publishing
* document npm publish version ownership and log the exact packed version

## [1.5.2](https://github.com/CyanAutomation/kaseki-agent/compare/v1.5.1...v1.5.2) (2026-05-09)

### Bug Fixes

* add always-auth option to npm setup in publish workflow ([c902a52](https://github.com/CyanAutomation/kaseki-agent/commit/c902a52464ea57e77cf3b9f80fdc7d73d39ef80b))
* add diagnostics to publish workflow and ensure NODE_AUTH_TOKEN is unset ([c08e02b](https://github.com/CyanAutomation/kaseki-agent/commit/c08e02b11ebb48e68091de684610f57908b0b242))
* add npm registry configuration step to workflow ([097a7a3](https://github.com/CyanAutomation/kaseki-agent/commit/097a7a339fd484221724ac608b722d216d9a9945))
* configure npm registry URL in setup-node action ([f473468](https://github.com/CyanAutomation/kaseki-agent/commit/f473468d8c5d57f717f6708cf9731f45d3f1ef45))
* downgrade setup-node action to v4 for compatibility ([5f7dce6](https://github.com/CyanAutomation/kaseki-agent/commit/5f7dce6d60ddd6030f6b8a0dfbeeace3871615db))
* revert Node.js engine version requirement to >=22 in package.json ([22dda4e](https://github.com/CyanAutomation/kaseki-agent/commit/22dda4e4a02b3272e4e35ffb8aaf1ce01667863d))
* revert Node.js version to 22.22.2 in npm publish workflow ([e093e83](https://github.com/CyanAutomation/kaseki-agent/commit/e093e83dff3da8e4fcdea461e9d99c5db179c43f))
* robust diagnostics and clean publish environment ([9882cab](https://github.com/CyanAutomation/kaseki-agent/commit/9882cab41244f6462d15ef3014beb916113430ee))
* simplify npm publishing setup by removing unnecessary authentication steps ([b1eef30](https://github.com/CyanAutomation/kaseki-agent/commit/b1eef304556c0731ed5ccaba8875fe05c53ab044))
* simplify repository URL and add publishConfig for OIDC ([fe87444](https://github.com/CyanAutomation/kaseki-agent/commit/fe874447697d688c6ef7a87d4875439305552ab2))
* update Node.js version to 24 in publish workflow ([0424037](https://github.com/CyanAutomation/kaseki-agent/commit/042403788a92182f349f79dc0e3aca5fdd8c30ad))
* update package.json version to match the published version during npm publish ([4ed8055](https://github.com/CyanAutomation/kaseki-agent/commit/4ed805590bd7af5b4ac5b6510460070fdcde4c07))
* update publish workflow for OIDC and bump version to 1.5.1 ([5311458](https://github.com/CyanAutomation/kaseki-agent/commit/531145818c8eb77533ac43478175c237f3a18820))
* update repository URL format in package.json ([3eb54bc](https://github.com/CyanAutomation/kaseki-agent/commit/3eb54bc9a28e054c4aef57299ce73c06d0577247))

## [1.5.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.5.0...v1.5.1) (2026-05-08)

### Bug Fixes

* enhance npm publish diagnostics and OIDC setup instructions in workflow ([0d78376](https://github.com/CyanAutomation/kaseki-agent/commit/0d78376ff354f3e22a268204c36d657dd122e37b))
* enhance version resolution logic for manual NPM publishing ([6104351](https://github.com/CyanAutomation/kaseki-agent/commit/6104351680d5401543acab206c43c25f54e26fdd))

## [1.5.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.4.1...v1.5.0) (2026-05-08)

### Features

* add GitHub Actions workflow for publishing to NPM ([e0a7e3c](https://github.com/CyanAutomation/kaseki-agent/commit/e0a7e3c6af932536c90a4ae798f0e7d5a6f3f172))
* enhance KASEKI_RESULTS_DIR handling by auto-creating directory and improving error messages ([818b208](https://github.com/CyanAutomation/kaseki-agent/commit/818b208680d7753319bda2d33339740e107562c5))

### Bug Fixes

* correct error message formatting in loadConfig function ([bba3909](https://github.com/CyanAutomation/kaseki-agent/commit/bba3909dc5934f7eb46490af51d0467e668cfe04))
* explicitly include undici in global pi-coding-agent installation to resolve module dependencies ([7137030](https://github.com/CyanAutomation/kaseki-agent/commit/7137030bacb766344f8ddd7f680c114787241600))
* update Docker GitHub Actions to Node.js 24 compatible versions ([0d56415](https://github.com/CyanAutomation/kaseki-agent/commit/0d56415cf72632bd07c9f44c2ad1bb5993c51b7f))
* update package.json to include missing files and add prepublish script ([e01cfdb](https://github.com/CyanAutomation/kaseki-agent/commit/e01cfdb041fbecb4e763a28bf113c5cfa8fd8087))
* update Pi CLI installation to create a wrapper script for proper module resolution ([1cbf744](https://github.com/CyanAutomation/kaseki-agent/commit/1cbf744ff440a9755dbfe4e05ae74b3d45273f66))
* update publish workflow to enhance OIDC trusted publishing and streamline npm authentication ([fa6c729](https://github.com/CyanAutomation/kaseki-agent/commit/fa6c729d1af51a0aaa3367270f2c45b2aadd296d))

## [1.4.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.3.0...v1.4.0) (2026-05-08)

### Features

* add CLI commands for configuration, health checks, instance listing, reporting, execution, secrets management, API service, and setup wizard ([a6ddde6](https://github.com/CyanAutomation/kaseki-agent/commit/a6ddde6371a50352b2f2fdd9e6d89aa13c956286))
* Add Pi Progress Summarizer with enhanced event handling and logging ([7aa8bb9](https://github.com/CyanAutomation/kaseki-agent/commit/7aa8bb974b645cc75c497f3acd0f8e12f1f8a9be))
* Enhance documentation and implement new features for kaseki-agent ([4df2c4b](https://github.com/CyanAutomation/kaseki-agent/commit/4df2c4b8b30a1e05e4eb07785c75ecc44f87f53f))
* Implement list command to display Kaseki instances with filtering and sorting ([9bd47e8](https://github.com/CyanAutomation/kaseki-agent/commit/9bd47e896f56432f5060a59d27c21ad24026e05f))
* Migrate Kaseki Agent to NPM package and enhance documentation ([7e825f4](https://github.com/CyanAutomation/kaseki-agent/commit/7e825f46bf05176ea4eeebce12256166623155ed))
* **validation:** enhance handling of missing npm scripts in validation commands ([1bfe5f8](https://github.com/CyanAutomation/kaseki-agent/commit/1bfe5f8d65aeb7597c88c3faaddad96157463350))

## [1.3.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.2.0...v1.3.0) (2026-05-08)

### Features

* add instance state derivation and metadata reader scripts to the Dockerfile ([b554b33](https://github.com/CyanAutomation/kaseki-agent/commit/b554b33bf28dba4bf49acfb7402a9f718df96374))
* enhance printf safety in github operations; add validation and logging improvements; introduce comprehensive test suite ([fd8457e](https://github.com/CyanAutomation/kaseki-agent/commit/fd8457e897fc0b82fc1ff2afc0e5b4cdf05751d1))
* enhance validation and error handling in json_encode and validate_numeric functions; add comprehensive test suite for printf safety ([7b5c828](https://github.com/CyanAutomation/kaseki-agent/commit/7b5c828c3fa01c4d802220e4f1d26b09ff8c2c3c))

### Bug Fixes

* move coverage variable declaration to the correct scope in restoration summary ([04f5c38](https://github.com/CyanAutomation/kaseki-agent/commit/04f5c384342c7fcd3c5491d8dcaf5a60f31c3763))
* optimize coverage calculation in restoration summary logging ([259d5fa](https://github.com/CyanAutomation/kaseki-agent/commit/259d5fa6673bb8b990b33a4ac20a6ed4e0f41c9e))
* update shellcheck directives for improved script linting ([602d994](https://github.com/CyanAutomation/kaseki-agent/commit/602d9949f5cc6e268984eea05c073b6db0039de8))

## [1.2.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.1.0...v1.2.0) (2026-05-07)

### Features

* enhance error handling in log scanning and centralize error patterns ([c485b40](https://github.com/CyanAutomation/kaseki-agent/commit/c485b405bf8b5f12dd2b26ade127a4494c65ed78))

## [1.1.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.0.1...v1.1.0) (2026-05-07)

### Features

* add extraction functions for validation and quality failure reasons ([f8f8ef3](https://github.com/CyanAutomation/kaseki-agent/commit/f8f8ef3327d90e396cdb3df00bf4b5ed5ab9a834))
* enhance documentation with additional guidance on allowlist patterns and task prompts ([17451da](https://github.com/CyanAutomation/kaseki-agent/commit/17451da713cc4755f450d88fe13e360a7d5721a0))
* enhance error reporting with structured failure reasons and API updates ([8846e9d](https://github.com/CyanAutomation/kaseki-agent/commit/8846e9d2bb1c903793269723de887ee27d3189c7))
* enhance pre-flight validation with comprehensive pattern matching functions and integration tests ([0480bc5](https://github.com/CyanAutomation/kaseki-agent/commit/0480bc5066aa67e3582936d6a4188bd8acb62280))
* Implement comprehensive allowlist restoration system in kaseki-agent ([9367503](https://github.com/CyanAutomation/kaseki-agent/commit/9367503ac3ad1d3dd53afd63bbc8b981665e843e))
* implement fail-fast validation behavior in Kaseki Agent ([d07b28c](https://github.com/CyanAutomation/kaseki-agent/commit/d07b28ccae7215064b43d4ec610b2e4df60abb9c))
* Implement Phase 1 Error Reporting Enhancements ([421390b](https://github.com/CyanAutomation/kaseki-agent/commit/421390b7ab063cc8839116c4b9de37c2d0806d04))
* remove trigger for Docker build workflow after release ([99ed6c5](https://github.com/CyanAutomation/kaseki-agent/commit/99ed6c5d03a161ba0eda5a6c792e27bb10849b3b))

## [1.0.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.0.0...v1.0.1) (2026-05-07)

### Bug Fixes

* disable PR comments in semantic-release to avoid permission errors ([0701e3e](https://github.com/CyanAutomation/kaseki-agent/commit/0701e3ebf6042a2999102c6cae19c1c7f33dee4c))

## 1.0.0 (2026-05-07)

### Features

* add artifact, log, status, and webhook routes ([d592e12](https://github.com/CyanAutomation/kaseki-agent/commit/d592e129038fac33cb7541e77e1776baf30edfa9))
* Add comprehensive implementation summary for Kaseki Agent API service ([bad4d94](https://github.com/CyanAutomation/kaseki-agent/commit/bad4d94fccc0bc5feab07c64def7a41a897ca7f8))
* add kaseki-cli command-line interface and demo ([0d2a566](https://github.com/CyanAutomation/kaseki-agent/commit/0d2a566156b15fae950c8115d4591236eb3763bf))
* Add post-implementation verification checklist for Kaseki Agent ([bb5e8ad](https://github.com/CyanAutomation/kaseki-agent/commit/bb5e8ad8d441e81781e421d248cbc0e4ff040b54))
* add semantic release configuration and changelog ([d77a35a](https://github.com/CyanAutomation/kaseki-agent/commit/d77a35ab7eb6f2ccbe9676b227223764a55bef74))
* add test utilities and validation tests for PreFlightValidator and configuration loading ([47bbed6](https://github.com/CyanAutomation/kaseki-agent/commit/47bbed69ad13351b804dc417fe7f3e6c831acc0f))
* Implement EventCounterAggregator for event stream processing ([be990ac](https://github.com/CyanAutomation/kaseki-agent/commit/be990ace9b16924c706b09070f0a986883d46686))
* Implement idempotency support and pre-flight validation for job submissions ([d5e0592](https://github.com/CyanAutomation/kaseki-agent/commit/d5e05923ddd3596c471ac86ff867f25cefa92e39))
* Implement Kaseki API client and service ([c779c9e](https://github.com/CyanAutomation/kaseki-agent/commit/c779c9e27ff09c2bc621019f883e026ced45732a))
* migrate project to TypeScript and update testing framework ([9309bdc](https://github.com/CyanAutomation/kaseki-agent/commit/9309bdc551c76841c61f60dcf481b6bcbceb2a7b))
* Refactor and expand public API exports, add job lookup middleware, and implement utility functions ([74dfd62](https://github.com/CyanAutomation/kaseki-agent/commit/74dfd62f442dfa58b97fd201994f4fb9f539d4ce))

### Bug Fixes

* Adjust formatting in verification checklist for clarity ([e028619](https://github.com/CyanAutomation/kaseki-agent/commit/e0286191e1d9056264d10339c7f619658d16fa64))
* correct regex pattern for matching imports in add-js-extensions script ([4cbe203](https://github.com/CyanAutomation/kaseki-agent/commit/4cbe2031a7364022463ac10bf2f030e1ca140b12))
* Correct regex pattern for matching imports in add-js-extensions.ts ([38fb48a](https://github.com/CyanAutomation/kaseki-agent/commit/38fb48a16c5ad869dc5efe36b1f906d7910a70d9))
* correct regex pattern for matching imports without extensions ([79bdabe](https://github.com/CyanAutomation/kaseki-agent/commit/79bdabe0a744bf7568c1af68f2dc91af76e532f1))
* correct regex pattern for matching relative imports in add-js-extensions script ([fb8f509](https://github.com/CyanAutomation/kaseki-agent/commit/fb8f509ea05a1bc460f4caa29e1113069bf00c81))
* disable no-explicit-any rule in TypeScript ESLint configuration ([ed905cb](https://github.com/CyanAutomation/kaseki-agent/commit/ed905cb7e8ef937989bc0ccfa5f56c6ce4d3a58c))
* Update readFileSync mock handling and improve instance stage resolution logic ([7e5afb8](https://github.com/CyanAutomation/kaseki-agent/commit/7e5afb87b2ab9fa808b3af9daad7c563dc48800d))

## [Unreleased]

### Features

### Bug Fixes

### Documentation

### Performance Improvements

---

## [0.1.0] - 2026-05-07

### Features

* Initial release of Kaseki Agent ephemeral coding-agent runner
* Multi-stage Docker build with dependency caching
* OpenRouter API integration for Pi CLI coding agents
* GitHub Actions workflow for multi-arch image builds (amd64 + arm64)
* Quality gates: diff size limits, changed-file allowlist, secret scanning
* Kaseki CLI for monitoring and analyzing runs
* Kaseki API service for job scheduling and webhook management
* Comprehensive logging and result artifacts

### Bug Fixes

### Documentation

* Complete README with usage examples
* Contributing guidelines for prompt changes and test expectations
* Deployment documentation for Docker Compose and Node.js
* Development workflow guide
* API documentation and CLI reference

[Unreleased]: https://github.com/CyanAutomation/kaseki-agent/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/CyanAutomation/kaseki-agent/releases/tag/v0.1.0
