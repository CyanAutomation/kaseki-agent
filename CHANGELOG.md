# Changelog

All notable changes to Kaseki Agent are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

# [1.88.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.87.2...v1.88.0) (2026-06-21)


### Features

* add progress-stream-diagnostics.log for enhanced error tracking and diagnostics ([8a1fd7f](https://github.com/CyanAutomation/kaseki-agent/commit/8a1fd7f22a4c8d42c83b94ae34c22d2939b24e8f))

## [1.87.2](https://github.com/CyanAutomation/kaseki-agent/compare/v1.87.1...v1.87.2) (2026-06-21)


### Bug Fixes

* remove unnecessary blank lines in test files ([4db730f](https://github.com/CyanAutomation/kaseki-agent/commit/4db730fe1db333ecc7aad324cbdd04d7f6a78e2f))
* validate packaged worker helpers ([21f86fb](https://github.com/CyanAutomation/kaseki-agent/commit/21f86fb134931afd674a57199efe7b9bbe71e3e7))

## [1.87.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.87.0...v1.87.1) (2026-06-21)


### Bug Fixes

* update entrypoint script path in Docker image build workflow ([59c76ad](https://github.com/CyanAutomation/kaseki-agent/commit/59c76ad1e5e9b13c7e630e737a36b280ea72c025))

# [1.87.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.86.0...v1.87.0) (2026-06-21)


### Features

* enhance secret path checks to avoid blocking errors for non-traversable directories ([fb07afa](https://github.com/CyanAutomation/kaseki-agent/commit/fb07afa05bd0de90e0fc9c34147979a96c735411))

# [1.86.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.85.0...v1.86.0) (2026-06-21)


### Bug Fixes

* dependency cache key check and update date format in tests ([d7e32a7](https://github.com/CyanAutomation/kaseki-agent/commit/d7e32a7cb0e79e871ce8b906d093a0b8aa21acda))


### Features

* add agent-prompt.sh copy and enhance debug logging in goal-setting tests ([cd37faf](https://github.com/CyanAutomation/kaseki-agent/commit/cd37faff5b0b19eea1478ce1f062688fd48d89f9))
* add INSTANCE_NAME variable for configurable instance naming ([66867c9](https://github.com/CyanAutomation/kaseki-agent/commit/66867c97cee361833f415d7c7ab318aa37158628))
* enhance docker entrypoint with fallback for startup checks and update test to include dependency cache helpers ([78a0414](https://github.com/CyanAutomation/kaseki-agent/commit/78a0414cf97c966a5fa17a98dc50adbf4d886625))
* read agent-prompt.sh directly for goal-check prompt tests ([892f520](https://github.com/CyanAutomation/kaseki-agent/commit/892f520c04793f0a6961e37a2df8fb362e60afe9))

# [1.85.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.84.0...v1.85.0) (2026-06-20)


### Bug Fixes

* simplify feature flag derivation logic in deriveFeatureFlags function ([10d9b96](https://github.com/CyanAutomation/kaseki-agent/commit/10d9b96236b3ee058c7fdd48012cf88771948e6c))


### Features

* enhance goal-setting artifact to preserve full task prompt and improve placeholder handling ([25026f3](https://github.com/CyanAutomation/kaseki-agent/commit/25026f35fdd2a0ea716b9553c50d707a0b2e7be3))

# [1.84.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.83.2...v1.84.0) (2026-06-20)


### Bug Fixes

* update LLM Gateway URL validation to accept base URL formats and improve error messaging ([1baf75f](https://github.com/CyanAutomation/kaseki-agent/commit/1baf75f150a80cf8b3473eff8adfa36bcdceaf9d))


### Features

* enhance LLM provider configuration and validation checks ([c507863](https://github.com/CyanAutomation/kaseki-agent/commit/c5078636ac381dbd39f77e99db0535a8901dd3e0))
* implement goal-setting fallback logic and associated tests ([3026a74](https://github.com/CyanAutomation/kaseki-agent/commit/3026a74d03bad716e8a11f50d0d4d0e0ae3d396d))

## [1.83.2](https://github.com/CyanAutomation/kaseki-agent/compare/v1.83.1...v1.83.2) (2026-06-20)


### Bug Fixes

* update LLM_GATEWAY_URL to use base URL only across documentation and scripts ([4c6047e](https://github.com/CyanAutomation/kaseki-agent/commit/4c6047e6a230ec6f016fc1cf654f63b7bd74e4dc))

## [1.83.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.83.0...v1.83.1) (2026-06-20)


### Bug Fixes

* harden gateway preflight and run diagnostics ([05f59d3](https://github.com/CyanAutomation/kaseki-agent/commit/05f59d3f79016c4b67c2c665195a9ac2842e35ed))

# [1.83.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.82.0...v1.83.0) (2026-06-20)


### Features

* add environment variable for PI extensions directory in smoke test ([da0903d](https://github.com/CyanAutomation/kaseki-agent/commit/da0903dc4b045defb4fe1ddebef8d651f19faaa6))

# [1.82.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.81.0...v1.82.0) (2026-06-20)


### Features

* enhance task progress calculation to prevent regression from late streaming events ([7f1e6b3](https://github.com/CyanAutomation/kaseki-agent/commit/7f1e6b36f6a33562254ad3532c626d2888060273))

# [1.81.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.80.10...v1.81.0) (2026-06-20)


### Features

* add LLM Gateway extension installation to Pi CLI ([dd90a09](https://github.com/CyanAutomation/kaseki-agent/commit/dd90a09ce2b20597578f213b151b4378051313c6))

## [1.80.10](https://github.com/CyanAutomation/kaseki-agent/compare/v1.80.9...v1.80.10) (2026-06-19)


### Bug Fixes

* update mock behavior for host secret path and set non-existent secrets directory in preflight diagnostics ([9d474fc](https://github.com/CyanAutomation/kaseki-agent/commit/9d474fc4d9a57a12277faeadb3339181d321e3f3))

## [1.80.9](https://github.com/CyanAutomation/kaseki-agent/compare/v1.80.8...v1.80.9) (2026-06-19)


### Bug Fixes

* add json helper script to test directories for improved functionality ([df99669](https://github.com/CyanAutomation/kaseki-agent/commit/df99669bcef80415353f1ba581ef3a04b940b7a7))
* update references from OpenRouter API key to LLM Gateway API key across the codebase ([00f917e](https://github.com/CyanAutomation/kaseki-agent/commit/00f917eb1c4e293c758aa74de22c1655bb19ae0b))

## [1.80.8](https://github.com/CyanAutomation/kaseki-agent/compare/v1.80.7...v1.80.8) (2026-06-19)


### Bug Fixes

* mount gateway key file for worker pi provider ([f42e276](https://github.com/CyanAutomation/kaseki-agent/commit/f42e27663387161eb5dd18382509abc9b9d5618a))
* mount gateway key file for worker pi provider ([#748](https://github.com/CyanAutomation/kaseki-agent/issues/748)) ([7a5f14b](https://github.com/CyanAutomation/kaseki-agent/commit/7a5f14bd7888078da858f3c83b674e45464ab0c5))

## [1.80.7](https://github.com/CyanAutomation/kaseki-agent/compare/v1.80.6...v1.80.7) (2026-06-18)


### Bug Fixes

* stage gateway host secret file for correct Docker mounts ([b376ed5](https://github.com/CyanAutomation/kaseki-agent/commit/b376ed550bb78deb0267c2d6b729bcdcc88c11f6))

## [1.80.6](https://github.com/CyanAutomation/kaseki-agent/compare/v1.80.5...v1.80.6) (2026-06-18)


### Bug Fixes

* add data-auth attribute to gateway test button and update related test ([59009c3](https://github.com/CyanAutomation/kaseki-agent/commit/59009c33a56ac0a72b95808df027b8bc20e6861b))

## [1.80.5](https://github.com/CyanAutomation/kaseki-agent/compare/v1.80.4...v1.80.5) (2026-06-18)


### Bug Fixes

* update error messages for missing environment variables in scripts ([98f6cc3](https://github.com/CyanAutomation/kaseki-agent/commit/98f6cc393fefb9f82d8873fce2435c7024dbe01a))

## [1.80.4](https://github.com/CyanAutomation/kaseki-agent/compare/v1.80.3...v1.80.4) (2026-06-18)


### Bug Fixes

* enhance GitHub App credential checks and improve error handling for missing configurations ([d79bf8e](https://github.com/CyanAutomation/kaseki-agent/commit/d79bf8e5f1783d1b2f6ef966eba6e79da73c427b))

## [1.80.3](https://github.com/CyanAutomation/kaseki-agent/compare/v1.80.2...v1.80.3) (2026-06-18)


### Bug Fixes

* ensure JSON helper script is copied to the correct directory in tests ([e49e7a5](https://github.com/CyanAutomation/kaseki-agent/commit/e49e7a530cae4b525ceeb7c6d199e8425070e622))
* remove unused FILTER_EXIT variable from validation logic ([7d961e2](https://github.com/CyanAutomation/kaseki-agent/commit/7d961e2a922cc4eb4ab294aa73dfb2cb6aedbe48))

## [1.80.2](https://github.com/CyanAutomation/kaseki-agent/compare/v1.80.1...v1.80.2) (2026-06-18)


### Bug Fixes

* enhance maturity score calculation and logging; add tests for stdout behavior ([132f6d4](https://github.com/CyanAutomation/kaseki-agent/commit/132f6d4f6b2dcc29ee794d3fda3a693c4a96c2e9))

## [1.80.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.80.0...v1.80.1) (2026-06-18)


### Bug Fixes

* Refactor LLM_GATEWAY_URL in DockerManager tests to use full URL ([d840b41](https://github.com/CyanAutomation/kaseki-agent/commit/d840b419ec026b062e2d6399e8dde2f80ee6d2e9))
* Update LLM_GATEWAY_URL example in error message for clarity ([c59de9a](https://github.com/CyanAutomation/kaseki-agent/commit/c59de9a2487e3a101357e7e3665d294b61eb23c7))

# [1.80.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.79.0...v1.80.0) (2026-06-17)


### Features

* Refactor LLM Gateway provider code for consistency and clarity; update type definitions and improve formatting ([226afbd](https://github.com/CyanAutomation/kaseki-agent/commit/226afbd8700a13ed2519b630c196e7773b602ec2))

# [1.79.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.78.4...v1.79.0) (2026-06-16)


### Bug Fixes

* enable diagnostic test and update mock return value for metadata.json ([3469e38](https://github.com/CyanAutomation/kaseki-agent/commit/3469e3844d93ae4f6f2e04082a125924a94e7ddd))


### Features

* add artifact content loader and diagnostic extractor utilities ([09c4150](https://github.com/CyanAutomation/kaseki-agent/commit/09c4150f31692b529d3227d27e6ee31da3a23024))

## [1.78.4](https://github.com/CyanAutomation/kaseki-agent/compare/v1.78.3...v1.78.4) (2026-06-13)


### Bug Fixes

* Clean up whitespace in drainResponseBody documentation for clarity ([7e98b26](https://github.com/CyanAutomation/kaseki-agent/commit/7e98b2609d42f9bc965b8a024c53664698982f16))
* Convert exported functions to internal in collect-feedback and scouting-allowlist scripts ([1944f18](https://github.com/CyanAutomation/kaseki-agent/commit/1944f187ef2221730f6b3ed7f99dec36aeca02ce))
* Refactor read-wrapper functions for improved clarity and add unit tests for validation and summarization logic ([4ad975a](https://github.com/CyanAutomation/kaseki-agent/commit/4ad975a0a5d38762812e0d369a2c01491644916b))
* Refactor validation functions in scouting-allowlist.js and add unit tests for improved artifact validation ([1bf3b41](https://github.com/CyanAutomation/kaseki-agent/commit/1bf3b419181b3ae97a16bd4ba44d73df2519be51))
* Remove unused helper functions and clean up test cases in scouting-allowlist validators ([6ebf184](https://github.com/CyanAutomation/kaseki-agent/commit/6ebf18450c08108df5db44afdec00d8a65615cd4))

## [1.78.3](https://github.com/CyanAutomation/kaseki-agent/compare/v1.78.2...v1.78.3) (2026-06-13)


### Bug Fixes

* Drain response body in various components to prevent handle leaks and improve resource management ([8810bc9](https://github.com/CyanAutomation/kaseki-agent/commit/8810bc96592dae2a7414e4ed20b75fc4dc529cc2))
* Drain response body in various components to prevent handle leaks and improve resource management ([c42abc2](https://github.com/CyanAutomation/kaseki-agent/commit/c42abc21bca30b512e2f8300997e5a0cbdb6de5d))
* Enhance cleanup in Jest setup to prevent connection pool exhaustion and improve HTTP response handling ([0dc21fd](https://github.com/CyanAutomation/kaseki-agent/commit/0dc21fd9b75317fb1be1a3ca4499b63b1894e4b4))
* Improve cleanup logic in Jest setup to prevent indefinite hanging during tests ([f973cc6](https://github.com/CyanAutomation/kaseki-agent/commit/f973cc663f3f72d35e6a1c7e6509f2d4af78037b))
* Improve Jest configuration and cleanup to prevent handle leaks during tests ([96371e3](https://github.com/CyanAutomation/kaseki-agent/commit/96371e3202eb5f2125221644f004260fd717de4d))
* Refactor tests for clarity and consistency in progress tracking and HTTP client functionality ([6dda2d6](https://github.com/CyanAutomation/kaseki-agent/commit/6dda2d6ea26e25ae7989ed59f5554aa7b49cf15d))

## [1.78.2](https://github.com/CyanAutomation/kaseki-agent/compare/v1.78.1...v1.78.2) (2026-06-13)


### Bug Fixes

* harden inspect-mode UI and worker flows ([d16bdc0](https://github.com/CyanAutomation/kaseki-agent/commit/d16bdc0f25417adb9ecb250615d4495057ffe4ec))

## [1.78.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.78.0...v1.78.1) (2026-06-11)


### Bug Fixes

* improve inspect diagnostics and web output ([d50c715](https://github.com/CyanAutomation/kaseki-agent/commit/d50c7151a709fbbc5d4293f64a53402060ba346c))
* improve inspect diagnostics and web output ([#682](https://github.com/CyanAutomation/kaseki-agent/issues/682)) ([82c0b7f](https://github.com/CyanAutomation/kaseki-agent/commit/82c0b7f08b2450388af89d2617fd7f19e4ace003))

# [1.78.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.77.0...v1.78.0) (2026-06-11)


### Features

* Add extraction functions for assessment, problems, solutions, and human review recommendations in artifact content helpers ([342162b](https://github.com/CyanAutomation/kaseki-agent/commit/342162bc69240b8c37d2f90760979904bd079092))
* Implement filesystem diagnostics and recovery for scouting artifacts, including validation checks and error handling ([32ed71e](https://github.com/CyanAutomation/kaseki-agent/commit/32ed71e70891a24559e2031fa78abf976acc9f29))

# [1.77.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.76.0...v1.77.0) (2026-06-11)


### Bug Fixes

* Correct regex replacements for environment variable paths in goal-setting script ([dc4d321](https://github.com/CyanAutomation/kaseki-agent/commit/dc4d321c185111f817736e9a2ab27ff438dc76e8))


### Features

* Add revised artifact evaluation and scoring quick reference documentation ([9c67882](https://github.com/CyanAutomation/kaseki-agent/commit/9c6788220bb3189137012c9cdbda1ac078635032))
* Consolidate phase data into metadata.json and update related documentation ([a994e18](https://github.com/CyanAutomation/kaseki-agent/commit/a994e181dd1d400a5f36a6c677bcfa8cb00ba3b2))
* Consolidate validation artifacts into metadata.json and update related documentation ([82c3a81](https://github.com/CyanAutomation/kaseki-agent/commit/82c3a81a20ee75c826b3db63baff0354ef6d8016))
* Enhance artifact consolidation with new metadata structure and cleanup logs ([a48c272](https://github.com/CyanAutomation/kaseki-agent/commit/a48c272c9e402118f88cc6cdf88694baefdb33a2))

# [1.76.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.75.0...v1.76.0) (2026-06-11)


### Features

* Implement artifact recovery and jq cache metrics fix tests ([e4ef8b2](https://github.com/CyanAutomation/kaseki-agent/commit/e4ef8b23238674ae32981e38a38d94973c1e6776))

# [1.75.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.74.0...v1.75.0) (2026-06-11)


### Features

* add artifact consolidation tests for various JSON and JSONL outputs ([3f19140](https://github.com/CyanAutomation/kaseki-agent/commit/3f191404927c40e5afdc5c76740dbc5a649e992f))
* enhance artifact routes to support deprecation handling and consolidation targets ([baec461](https://github.com/CyanAutomation/kaseki-agent/commit/baec4616e25252281c98343c5eb040eb2045fbe4))
* enhance GoCliSummarizer error handling and improve test coverage for parsing errors ([b2ac123](https://github.com/CyanAutomation/kaseki-agent/commit/b2ac123f5167041ed2b6efa2a6757c925dd3dfd1))
* Implement comprehensive artifact evaluation and consolidation strategy ([d69f5d6](https://github.com/CyanAutomation/kaseki-agent/commit/d69f5d69239992329028dac7d87f83462efce263))

# [1.74.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.73.0...v1.74.0) (2026-06-10)


### Bug Fixes

* include pre-compiled analyzer scripts in production Docker image and prefer them in agent script ([89231c1](https://github.com/CyanAutomation/kaseki-agent/commit/89231c1aeecc308c38677efc087038e292642767))


### Features

* add structured JSON artifact outputs for validation results, quality gates, cache metrics, and secret scans ([464a7e1](https://github.com/CyanAutomation/kaseki-agent/commit/464a7e10d480ab9d7b729d47442cfbeae9705af0))
* consolidate phase summaries into all-phase-summaries.json and update artifact metadata ([cdc99c3](https://github.com/CyanAutomation/kaseki-agent/commit/cdc99c31352e2749e01950078ccd9f1aee1f15cf))
* consolidate timing and error data into new JSON and JSONL artifacts ([d20e72c](https://github.com/CyanAutomation/kaseki-agent/commit/d20e72c5da1a60f3730baac8b22ef6cdbf4dfc2f))
* emit quality violation events to JSON for restored files and auto lint cleanup ([2f42727](https://github.com/CyanAutomation/kaseki-agent/commit/2f427278bc20390a0c5ed58a5e4f5fa4b6d96f87))
* implement JSON output for quality violations and cache metrics during dependency management ([2c518b2](https://github.com/CyanAutomation/kaseki-agent/commit/2c518b238b7141962e94bdda86ddcf935195f16d))

# [1.73.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.72.0...v1.73.0) (2026-06-10)


### Features

* add tests for goal-setting improvements including context preservation and SMART criteria validation ([f933cae](https://github.com/CyanAutomation/kaseki-agent/commit/f933caee7396739784829c85f85f281a4ebfdbf6))
* refactor tests for goal-setting artifacts and inspect report; add anti-patterns extraction tests ([8e735e3](https://github.com/CyanAutomation/kaseki-agent/commit/8e735e3cef8b2400e3cdaab5a3cda2f13deffe88))

# [1.72.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.71.0...v1.72.0) (2026-06-10)


### Bug Fixes

* add pre-validation log output and clean up whitespace in functional test ([d838d88](https://github.com/CyanAutomation/kaseki-agent/commit/d838d88d6592e77d987cd1056eaed028db150179))
* ensure tree-sitter binary is copied from deps stage in Dockerfile ([3e09e8d](https://github.com/CyanAutomation/kaseki-agent/commit/3e09e8d8100153156c2113b82151abda2db41a91))
* update default parseTimeoutMs to 2000ms and summarize timeout to 1000ms in GoCliSummarizer ([faeac11](https://github.com/CyanAutomation/kaseki-agent/commit/faeac11c7d4357820749b7f3770e7b8f049808d3))
* update parseTimeoutMs default value to 500ms in summarizer config; adjust maxWorkers setting in jest config ([c83b030](https://github.com/CyanAutomation/kaseki-agent/commit/c83b030d37b1e290c8c8bb89284fd68fa8054284))
* update restore_disallowed_changes test to emit correct function for workspace paths ([b1ed27a](https://github.com/CyanAutomation/kaseki-agent/commit/b1ed27ab62f62d38f201e236e1deeae09a754a00))
* update test command for tree-sitter functional tests and clean up whitespace in Go CLI summarizer tests ([cf43db2](https://github.com/CyanAutomation/kaseki-agent/commit/cf43db232048747f86a944fb028524c052d81d5a))


### Features

* add Go CLI summarizer and TypeScript Compiler API summarizer ([b52a28f](https://github.com/CyanAutomation/kaseki-agent/commit/b52a28f4ebeaaaa931ad6878c53711c48b4b3452))
* enhance GoCliSummarizer to accept content strings and manage temp files; update tests for graceful degradation ([1968c1e](https://github.com/CyanAutomation/kaseki-agent/commit/1968c1e690ff24789f1ac540c358b97cc7d876ec))

# [1.71.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.70.1...v1.71.0) (2026-06-09)


### Features

* enhance result summary generation with detailed metadata and validation status ([a8038d6](https://github.com/CyanAutomation/kaseki-agent/commit/a8038d6eae21d4a658b07dc3fbd260bc8afa1ac8))

## [1.70.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.70.0...v1.70.1) (2026-06-09)


### Bug Fixes

* remove unnecessary files from application copy in Dockerfile ([0a27cd6](https://github.com/CyanAutomation/kaseki-agent/commit/0a27cd605b1aeac8d213c94d0e0b5b1841646455))

# [1.70.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.69.3...v1.70.0) (2026-06-09)


### Bug Fixes

* correct output redirection in error messages for clarity ([0338ec2](https://github.com/CyanAutomation/kaseki-agent/commit/0338ec210283206bac2a34515f2af159c11f9c5a))
* enable downlevel iteration in TypeScript configuration and update related files ([5c7e880](https://github.com/CyanAutomation/kaseki-agent/commit/5c7e880f23b4a5969fea03824b3e6f6da216733e))
* enhance feedback collection script error handling and improve optional file parsing ([6d2b54c](https://github.com/CyanAutomation/kaseki-agent/commit/6d2b54c19ab8b8550ed453ccc6175e7d18091335))
* enhance language initialization handling and improve bash function extraction validation ([36de2d3](https://github.com/CyanAutomation/kaseki-agent/commit/36de2d3118ca0f526cdc6253c691cda6740cb1f9))
* enhance orchestration environment setup for goal-check and run-evaluation phases ([d978608](https://github.com/CyanAutomation/kaseki-agent/commit/d97860817a09f11e73237ec052ee1d15d2ecd42e))
* improve feedback collection script with enhanced error handling and payload structure ([2027e48](https://github.com/CyanAutomation/kaseki-agent/commit/2027e48e7282efa392af8519f00e73f7068cb3fc))
* improve language binding initialization for TypeScript and Go in TreeSitterSummarizer ([2ba2793](https://github.com/CyanAutomation/kaseki-agent/commit/2ba2793e36f0d704147c805b8a0bf1be31adafa3))
* improve orchestration environment handling for goal-check and run-evaluation phases ([d0c7b13](https://github.com/CyanAutomation/kaseki-agent/commit/d0c7b13ca37e53e069d8a7f4e31a06abeb7453bb))
* refactor artifact metadata and update validation logging in tests ([ab38821](https://github.com/CyanAutomation/kaseki-agent/commit/ab388216e1a2a9e98634476c4c76637f247c7d48))
* streamline feedback payload structure in run-evaluation phase ([fa79930](https://github.com/CyanAutomation/kaseki-agent/commit/fa799304aa14b519969162dd412ef6e2806db4e2))
* update goal-check validation logic to allow for multiple calls ([185cc24](https://github.com/CyanAutomation/kaseki-agent/commit/185cc24bcac90f233ac893b0258f48ce7af99870))


### Features

* add lightweight orchestration stubs for feedback collection tests ([657767c](https://github.com/CyanAutomation/kaseki-agent/commit/657767cb286bb4f87219294d48d239a0d5f74131))
* add test utilities for bash script caching, fake binaries, and git repositories ([7a72cae](https://github.com/CyanAutomation/kaseki-agent/commit/7a72cae9de5315b8df3cfd7c3188799232581e5e))

## [1.69.3](https://github.com/CyanAutomation/kaseki-agent/compare/v1.69.2...v1.69.3) (2026-06-08)


### Bug Fixes

* remove unnecessary files from Dockerfile copy command ([a384631](https://github.com/CyanAutomation/kaseki-agent/commit/a384631bae7e1cafe50a3a66b2542215a304d48a))

## [1.69.2](https://github.com/CyanAutomation/kaseki-agent/compare/v1.69.1...v1.69.2) (2026-06-08)


### Bug Fixes

* improve error handling and enhance summary extraction in TreeSitterSummarizer ([ca68784](https://github.com/CyanAutomation/kaseki-agent/commit/ca68784284f0ba6babcc19c49b7f8ba6526fb2e5))

## [1.69.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.69.0...v1.69.1) (2026-06-08)


### Bug Fixes

* adjust KASEKI_ALLOW_EMPTY_DIFF based on KASEKI_TASK_MODE ([bd855f4](https://github.com/CyanAutomation/kaseki-agent/commit/bd855f4fd67fcd2039445343217af3002b7f0c23))

# [1.69.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.68.1...v1.69.0) (2026-06-08)


### Bug Fixes

* enhance node traversal and extraction in TreeSitterSummarizer ([faac545](https://github.com/CyanAutomation/kaseki-agent/commit/faac545032b6ea94b0e054dae2c156d016fcf942))
* enhance run counting and listing in cleanup scripts ([869e38c](https://github.com/CyanAutomation/kaseki-agent/commit/869e38c1418bb57b42480b306563aa3e0f28651b))
* improve debug logging for cache directory scanning errors ([9edd68b](https://github.com/CyanAutomation/kaseki-agent/commit/9edd68b6f8588aa788f81cc5eed56474a5915635))
* remove unnecessary whitespace in extractName method ([db5c13b](https://github.com/CyanAutomation/kaseki-agent/commit/db5c13beba1fbafc5ef2671832370b6193e415fd))


### Features

* add cleanup command for managing kaseki run artifacts ([ef818bb](https://github.com/CyanAutomation/kaseki-agent/commit/ef818bb3c25abf8bbea2e828a1f838c67235b249))

## [1.68.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.68.0...v1.68.1) (2026-06-08)


### Bug Fixes

* update Dockerfile and .dockerignore to correctly reference docker/ops directory ([74e1a6f](https://github.com/CyanAutomation/kaseki-agent/commit/74e1a6ffbf4d468f76493fcb699e0110afd92e68))

# [1.68.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.67.0...v1.68.0) (2026-06-07)


### Bug Fixes

* simplify error handling in SummaryCache and ReadWrapper tests ([6d665e6](https://github.com/CyanAutomation/kaseki-agent/commit/6d665e644b250dac801fb469308b3ab81b739c77))
* update paths for style guide in maturity score evaluation ([5f36fbd](https://github.com/CyanAutomation/kaseki-agent/commit/5f36fbdd3f58d630a084dde89fbf3c82f8d2a594))


### Features

* add debug script for testing Feature 3 summarization and metrics ([cb0806d](https://github.com/CyanAutomation/kaseki-agent/commit/cb0806d72098de4d633741b261ff78e31d4e1957))
* add global mocks for tree-sitter to improve test reliability ([9a1b836](https://github.com/CyanAutomation/kaseki-agent/commit/9a1b836a68d1e5491d2aa812b0fce2a00f8ab582))
* add global mocks for tree-sitter to improve test reliability ([679940c](https://github.com/CyanAutomation/kaseki-agent/commit/679940c1e95796f3f10707ceb8ac611a6536fdee))
* add integration guide and completion summary for Feature 3 code summarization ([8d095a5](https://github.com/CyanAutomation/kaseki-agent/commit/8d095a5b31f5a9d76c704d72809ac36659a62b2a))
* add integration tests and CLI utility for Feature 3 summarization ([5463164](https://github.com/CyanAutomation/kaseki-agent/commit/546316416fe9fc542fc0245df7e89b3da065be4b))
* add kaseki-summarizer CLI tool for repository summarization and metadata generation ([e42b692](https://github.com/CyanAutomation/kaseki-agent/commit/e42b692a02765bc27557f30e4feafe82dcb7bf2a))
* add tree-sitter mocks to test files for improved testing coverage ([1af9d4a](https://github.com/CyanAutomation/kaseki-agent/commit/1af9d4a035fe1cd7655877dd43ea6eefdd2eb3a5))
* enhance tree-sitter integration with error handling and functional tests ([cac2a9d](https://github.com/CyanAutomation/kaseki-agent/commit/cac2a9d6e74f15ae60e6ba595a63a799a8257bf6))

# [1.67.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.66.0...v1.67.0) (2026-06-06)


### Bug Fixes

* correct formatting in async impact analysis and language detection functions ([36c2e33](https://github.com/CyanAutomation/kaseki-agent/commit/36c2e333fc4e46f7809cef67cadad3ee42cfb284))


### Features

* add compilation validation documentation and async awareness guide ([2d44d8a](https://github.com/CyanAutomation/kaseki-agent/commit/2d44d8a96631de55be577bbc71e1379064c141da))
* add compilation validator with tests for build command execution and logging ([8f6efb9](https://github.com/CyanAutomation/kaseki-agent/commit/8f6efb9985840c8b2884acefb67b86593e2690d8))
* add goal-setting criteria builder and enhance async impact analysis ([82350d9](https://github.com/CyanAutomation/kaseki-agent/commit/82350d9f3423943f446373bad7d410f2b144975a))
* add logging for unmatched prompts and create full test output script ([62bd501](https://github.com/CyanAutomation/kaseki-agent/commit/62bd501f3ddd14825f2ad9b2292e4f6140c1f42c))
* enhance type definitions and improve test assertions for async impact analysis ([29faffc](https://github.com/CyanAutomation/kaseki-agent/commit/29faffc0051df3960c57279d651ded3b39f48ad3))
* implement scouting context builder for TASK_PROMPT and enhance goal validation criteria ([1c505e2](https://github.com/CyanAutomation/kaseki-agent/commit/1c505e2335b4b63be7b65808f7c407ba5f3a1566))
* refactor async impact analysis import and enhance build context tests ([bd56e83](https://github.com/CyanAutomation/kaseki-agent/commit/bd56e83740d54691734e441d3d945ccaf9eee63d))

# [1.66.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.65.3...v1.66.0) (2026-06-06)


### Bug Fixes

* correct URL return value in artifact routes test and improve bash condition syntax ([6a099be](https://github.com/CyanAutomation/kaseki-agent/commit/6a099bebacdc3c49f8816cda364cd4e0e0bd25f0))
* enhance cleanup in Jest setup to prevent handle leaks and reset mocks ([44f7b18](https://github.com/CyanAutomation/kaseki-agent/commit/44f7b181557476581378aee6fed617a2056bbc06))
* enhance resource cleanup in tests and job scheduler to prevent handle leaks ([1ccc18e](https://github.com/CyanAutomation/kaseki-agent/commit/1ccc18e81a51f8bd0a9102a8a5b3d6de61bd8c86))
* escape newline character in JSON string for event logging ([ebd6955](https://github.com/CyanAutomation/kaseki-agent/commit/ebd6955fc4da8675794dd27d5da90a34126fe567))


### Features

* add artifact utilities and tests for content type classification ([7658d9b](https://github.com/CyanAutomation/kaseki-agent/commit/7658d9b6d45dcb7636e4343b2ff7408884061d26))
* add copy-to-clipboard functionality for recommended artifacts and enhance toast notifications ([76aac00](https://github.com/CyanAutomation/kaseki-agent/commit/76aac000ce88f3fbc7b2d10629c5c6544e29133e))
* add KASEKI_GOAL_CHECK environment variable for goal-check configuration ([e077476](https://github.com/CyanAutomation/kaseki-agent/commit/e077476aa059c4f6ace56e78557174f333e4e38d))
* add KASEKI_SKIP_PERMISSION_VALIDATION for test isolation in entrypoint ([12000b2](https://github.com/CyanAutomation/kaseki-agent/commit/12000b259afbbfb2319e6bf6bb372343f739eb1d))
* implement copy-to-clipboard functionality with toast notifications ([163b05f](https://github.com/CyanAutomation/kaseki-agent/commit/163b05fcd6918b6ad0b1303394e3dd6b283599d0))
* optimize artifact content type lookup for recommended artifacts ([80ed439](https://github.com/CyanAutomation/kaseki-agent/commit/80ed43940828303362816631f30a78bc4e55d704))

## [1.65.3](https://github.com/CyanAutomation/kaseki-agent/compare/v1.65.2...v1.65.3) (2026-06-06)


### Bug Fixes

* accept stdout status diagnostics in clients ([9023830](https://github.com/CyanAutomation/kaseki-agent/commit/90238304e9685fcf1e0907979b5d358d37b67358))
* improve preflight template diagnostics ([5650854](https://github.com/CyanAutomation/kaseki-agent/commit/5650854ecbc4a1658182fafac35ab8bbf157a2a0))
* status client schema for stdout diagnostics ([#607](https://github.com/CyanAutomation/kaseki-agent/issues/607)) ([7c7a91f](https://github.com/CyanAutomation/kaseki-agent/commit/7c7a91fed0dedcaa318150208991b95e69fe9e46))

## [1.65.2](https://github.com/CyanAutomation/kaseki-agent/compare/v1.65.1...v1.65.2) (2026-06-06)


### Bug Fixes

* Delete PHASE_1-3_COMPLETION.md ([7082f38](https://github.com/CyanAutomation/kaseki-agent/commit/7082f380e789a16cb9ff207f608ee41522e64e21))

## [1.65.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.65.0...v1.65.1) (2026-06-05)


### Bug Fixes

* add KASEKI_WORKSPACE_DIR to environment variables in orchestration tests ([19bbb06](https://github.com/CyanAutomation/kaseki-agent/commit/19bbb06a127e8291d14d96379160ff970e9b0e75))
* correct tab character in run-evaluation result file path validation ([f8b40cb](https://github.com/CyanAutomation/kaseki-agent/commit/f8b40cb78a2cac4275264a9daa8892c1fc543a76))
* optimize evaluation prompt tests by caching script content to reduce file reads ([36f6031](https://github.com/CyanAutomation/kaseki-agent/commit/36f60310fe4c9fc0e86fa442955ba6c465511c2e))
* update feedback script path and increment API version to 1.65.0 ([ce36a0d](https://github.com/CyanAutomation/kaseki-agent/commit/ce36a0d51cc3d7abc50d6cb90a37ea1b760dbb04))
* update result file paths to use KASEKI_RESULTS_DIR and improve script organization ([cd9260d](https://github.com/CyanAutomation/kaseki-agent/commit/cd9260daea689f5ddea1657d408534ecbc887756))

# [1.65.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.64.5...v1.65.0) (2026-06-05)


### Bug Fixes

* increase tmpfs size for agent containers in Docker run commands ([b30981d](https://github.com/CyanAutomation/kaseki-agent/commit/b30981d32499379f90b3d34a2747ef8f08cdd3ec))
* Update pi-coding-agent version to 0.77.0 in Dockerfile and documentation ([3abee37](https://github.com/CyanAutomation/kaseki-agent/commit/3abee37f60a39b2ecef3cb14ddcfee3a27bd8b20))


### Features

* Implement token usage tracking and aggregation in Pi event stream ([614dd53](https://github.com/CyanAutomation/kaseki-agent/commit/614dd53db43388c7a04df614e3c1d3863e1c56e9))

## [1.64.5](https://github.com/CyanAutomation/kaseki-agent/compare/v1.64.4...v1.64.5) (2026-06-05)


### Bug Fixes

* Add missing shellcheck directive for improved linting ([3d49bac](https://github.com/CyanAutomation/kaseki-agent/commit/3d49bacbd25a47eaf59973989ef5436f97eb57d6))
* Correct quoting for file path normalization in check_secret_scan_allowlist function ([6e8be32](https://github.com/CyanAutomation/kaseki-agent/commit/6e8be325a8cffeee2113c9da076bd8afe9c4f081))
* Ensure proper quoting for KASEKI_RESULTS_DIR in scripts and tests ([a049fea](https://github.com/CyanAutomation/kaseki-agent/commit/a049fea9f0ac7e6a8e9d6aebb102a5eb9e2e8531))

## [1.64.4](https://github.com/CyanAutomation/kaseki-agent/compare/v1.64.3...v1.64.4) (2026-06-05)


### Bug Fixes

* Refactor code structure for improved readability and maintainability ([fab3273](https://github.com/CyanAutomation/kaseki-agent/commit/fab327362418a2b229af88a97b500e27c1974178))

## [1.64.3](https://github.com/CyanAutomation/kaseki-agent/compare/v1.64.2...v1.64.3) (2026-06-05)


### Bug Fixes

* export entrypoint path defaults before dispatch ([78b2bd3](https://github.com/CyanAutomation/kaseki-agent/commit/78b2bd3281f700876428ccc7c4a81b4e45a06757))
* export entrypoint path defaults before dispatch ([#595](https://github.com/CyanAutomation/kaseki-agent/issues/595)) ([aa27e7d](https://github.com/CyanAutomation/kaseki-agent/commit/aa27e7d78bc536e33751a088a63203ac51f17407))

## [1.64.2](https://github.com/CyanAutomation/kaseki-agent/compare/v1.64.1...v1.64.2) (2026-06-05)


### Bug Fixes

* Add helper resolution check for allowlist and export KASEKI_RESULTS_DIR ([8e65c77](https://github.com/CyanAutomation/kaseki-agent/commit/8e65c77dcf6e7d71cf9161ca6a43fde80a15dbdb))
* Add shellcheck directive for allowlist helper and correct array syntax for mkdir_paths ([96d4d22](https://github.com/CyanAutomation/kaseki-agent/commit/96d4d22f13d316903d77500553d1afb5caff9b6c))

## [1.64.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.64.0...v1.64.1) (2026-06-05)


### Bug Fixes

* Test collect-feedback via CLI and export ESM helpers ([#586](https://github.com/CyanAutomation/kaseki-agent/issues/586)) ([8b35d12](https://github.com/CyanAutomation/kaseki-agent/commit/8b35d12bf74010ad39bb9c3488a9ccd525c257f7))

# [1.64.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.63.0...v1.64.0) (2026-06-05)


### Features

* improve startup health reporting and refine test descriptions ([d994052](https://github.com/CyanAutomation/kaseki-agent/commit/d99405296c1043852b4866e011fa6033f3f33811))
* **startup:** add comprehensive startup health reporting and progress tracking ([8056aef](https://github.com/CyanAutomation/kaseki-agent/commit/8056aef1c7eae3cac7831be5eaac716dc3f2a429))

# [1.63.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.62.1...v1.63.0) (2026-06-05)


### Bug Fixes

* enhance error handling and logging in service bootstrapper, improve ESLint config, and refine container preflight diagnostics ([d09f49f](https://github.com/CyanAutomation/kaseki-agent/commit/d09f49f959b8160951fe04c6b1dade7eedecff32))


### Features

* update API version to 1.62.1 and enhance startup checks with auto-remediation support ([4416b8d](https://github.com/CyanAutomation/kaseki-agent/commit/4416b8d03fe6c9febdd88bedca2dcbcac0a46fe7))

## [1.62.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.62.0...v1.62.1) (2026-06-04)


### Bug Fixes

* correct argument order in run_privilege_tools_parallel function ([1f9d1e7](https://github.com/CyanAutomation/kaseki-agent/commit/1f9d1e705035ad9c920ef0f4736ed42e9433d620))

# [1.62.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.61.0...v1.62.0) (2026-06-04)


### Bug Fixes

* improve success rate calculation formatting in ToolReliabilityAggregator ([923ebb0](https://github.com/CyanAutomation/kaseki-agent/commit/923ebb0c0fbda95ac55c5c8e48a696c206954610))


### Features

* add explicit mount for worker container access to results directory in docker-compose ([c5f45f4](https://github.com/CyanAutomation/kaseki-agent/commit/c5f45f47a3b93a9da086a94cddae0735a4c8956e))
* add tool reliability and execution time metrics tracking ([490aab8](https://github.com/CyanAutomation/kaseki-agent/commit/490aab8b85ec738eff023d01bd629e57fe7b612a))
* enhance privilege operation timeout and add permission verification ([6713d8f](https://github.com/CyanAutomation/kaseki-agent/commit/6713d8f45b71f277e38cb039dd5e3849c37df96b))
* implement error classification and enhance JSON output for setup results ([81a8ea3](https://github.com/CyanAutomation/kaseki-agent/commit/81a8ea35b440ca25cf1070b472395a2b1026d77e))
* implement validation infrastructure and refactor host setup script ([0023e89](https://github.com/CyanAutomation/kaseki-agent/commit/0023e8932c865312330c07382ae8bbc2fd6ae06b))
* update API version to 1.61.0 and enhance PiEvent interface with optional text field ([0dadd72](https://github.com/CyanAutomation/kaseki-agent/commit/0dadd721ea4a2574fcbd537fc2cc940674b2b38d))

# [1.61.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.60.0...v1.61.0) (2026-06-04)


### Bug Fixes

* harden packed-artifact runtime validation ([#574](https://github.com/CyanAutomation/kaseki-agent/issues/574)) ([8d0f8db](https://github.com/CyanAutomation/kaseki-agent/commit/8d0f8dba7e1c52d63101efa23e914ce6ff3e3586))
* validate packed artifact from clean install ([893312f](https://github.com/CyanAutomation/kaseki-agent/commit/893312f7bf5743ade35ffa269b7fe57ab503b866))


### Features

* add exit code 86 for scouting validation failure and related troubleshooting steps ([0b0bc1e](https://github.com/CyanAutomation/kaseki-agent/commit/0b0bc1e2722fcb86b4076af5f62ea02160a03e08))

# [1.60.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.59.0...v1.60.0) (2026-06-03)


### Bug Fixes

* export baseline validation variables and correct string delimiter in test ([e9674be](https://github.com/CyanAutomation/kaseki-agent/commit/e9674be4fae8f0498295f3019f99b3b032fd40bb))


### Features

* Add CLI wrapper and integration tests for hashline event processing ([d1b3042](https://github.com/CyanAutomation/kaseki-agent/commit/d1b30423e6dd2f648acf9359c5fb95d157cf8cb6))
* Add hashline event handler CLI and integration tests ([95da948](https://github.com/CyanAutomation/kaseki-agent/commit/95da9485c1ef2c3026317a79715100cd1b5422e5))
* Enhance task prompt with hashline_edit guidance and add corresponding tests ([7f96081](https://github.com/CyanAutomation/kaseki-agent/commit/7f960819f853171f11000175d2a0507604b3ca7d))
* Implement Hashline Validator for content-based editing ([2b2df82](https://github.com/CyanAutomation/kaseki-agent/commit/2b2df82886c4ea62b142d104e9e26a76a806c9c9))
* Update hashline event handling and improve regex detection in tests ([48ab453](https://github.com/CyanAutomation/kaseki-agent/commit/48ab4534f8a3f31809cae55cedc5b72c2e2f20df))

# [1.59.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.58.5...v1.59.0) (2026-06-02)


### Features

* add baseline test failure comparison feature with detailed documentation and integration tests ([9a3887b](https://github.com/CyanAutomation/kaseki-agent/commit/9a3887b4f170d72a7df194154ee31588e137bf56))
* add documentation cross-reference tests for evaluation prompts and goal-setting guide ([206ff4c](https://github.com/CyanAutomation/kaseki-agent/commit/206ff4c51f8e416b79e029bd62636dd21a112d21))
* add documentation integrity tests for cross-references and structure validation ([f92301d](https://github.com/CyanAutomation/kaseki-agent/commit/f92301df347aa63ede24285984b6a11d62efcbe4))
* add goal-setting artifacts and metrics tracking to the registry ([efe8369](https://github.com/CyanAutomation/kaseki-agent/commit/efe83698d01ffa0e0a3e8c399ba08e5db421d8db))
* add validation failure causality analysis architecture documentation ([1df07ec](https://github.com/CyanAutomation/kaseki-agent/commit/1df07ec380867a9968d4908e09281131295aeedd))
* enhance Jest configuration and add comprehensive tests for task progress percentage calculations ([4cdc815](https://github.com/CyanAutomation/kaseki-agent/commit/4cdc815a9dcd964783c9c92da17bafa6f2946a68))
* enhance test guidance and status response handling with improved validation and clamping logic ([9d26a44](https://github.com/CyanAutomation/kaseki-agent/commit/9d26a445ff08eecb951284e7818fa7bd43082887))
* implement baseline validation for test failure analysis ([543a17a](https://github.com/CyanAutomation/kaseki-agent/commit/543a17af98b4fcb6fc8055065899055e54ced809))
* implement validation failure causality analysis with integration tests and documentation ([e70b881](https://github.com/CyanAutomation/kaseki-agent/commit/e70b881561b1427f83bc91c736a27cbf1c941aa7))
* Integrate causality assessment into goal-check process ([05546b4](https://github.com/CyanAutomation/kaseki-agent/commit/05546b42f6957455d323026191be813906cc849a))
* integrate feedback collection after run evaluation and update related tests ([3a1b0ca](https://github.com/CyanAutomation/kaseki-agent/commit/3a1b0ca9b6436a997c62dcc0110a6c5790dccbba))
* refine function end detection logic and remove outdated documentation tests in evaluation prompts ([695d9c5](https://github.com/CyanAutomation/kaseki-agent/commit/695d9c5b2b5801ef3a726b3e0e5f899e07d25d07))
* remove unused imports and update path resolution in test files ([2d92f45](https://github.com/CyanAutomation/kaseki-agent/commit/2d92f45cc58c1566482025388207a408c10dc47c))
* update evaluation prompt tests for feedback collection and adjust goal quality score expectation ([4cc40c7](https://github.com/CyanAutomation/kaseki-agent/commit/4cc40c7b3eb375a411a88e2952724e94aa2e99bd))
* update Jest configuration and add tests for task progress percentage calculations ([9054e4f](https://github.com/CyanAutomation/kaseki-agent/commit/9054e4f9065878a0dac708b2c066c9380fced014))
* update Jest configuration and tests for improved progress calculation and validation ([e99f19b](https://github.com/CyanAutomation/kaseki-agent/commit/e99f19bb47f7b513ffeb0df56376f45821c7745a))
* update scoring system and enhance quality warning checks in goal evaluation ([218f094](https://github.com/CyanAutomation/kaseki-agent/commit/218f09474a72c0cb160a52bd2df5ea373051eac2))

## [1.58.5](https://github.com/CyanAutomation/kaseki-agent/compare/v1.58.4...v1.58.5) (2026-06-02)


### Bug Fixes

* progress parsing in JobScheduler.parseLiveProgressEv... (kaseki-91) ([#542](https://github.com/CyanAutomation/kaseki-agent/issues/542)) ([b2cf3f7](https://github.com/CyanAutomation/kaseki-agent/commit/b2cf3f74f0a0525530df8106883c8791ae40a9dd))

## [1.58.4](https://github.com/CyanAutomation/kaseki-agent/compare/v1.58.3...v1.58.4) (2026-06-01)


### Bug Fixes

* progress calculation in status response builder by m... (kaseki-88) ([#530](https://github.com/CyanAutomation/kaseki-agent/issues/530)) ([5c52405](https://github.com/CyanAutomation/kaseki-agent/commit/5c52405e2e05929cec511eee5fb5ab8116446666))

## [1.58.3](https://github.com/CyanAutomation/kaseki-agent/compare/v1.58.2...v1.58.3) (2026-06-01)


### Bug Fixes

* enhance modal accessibility and error handling with ARIA attributes and hidden states ([12a2d9c](https://github.com/CyanAutomation/kaseki-agent/commit/12a2d9c32507e614cb76fe798d822c8f4b8cf5a8))

## [1.58.2](https://github.com/CyanAutomation/kaseki-agent/compare/v1.58.1...v1.58.2) (2026-05-31)


### Bug Fixes

* scope tab content selectors to main and modal-tabs-container for improved specificity ([8438a57](https://github.com/CyanAutomation/kaseki-agent/commit/8438a5739acfbeb0d12a39e0ff7f89097aa60ea2))

## [1.58.1](https://github.com/CyanAutomation/kaseki-agent/compare/v1.58.0...v1.58.1) (2026-05-31)


### Bug Fixes

* scope tab content styles to modal-tabs-container for better encapsulation ([266662c](https://github.com/CyanAutomation/kaseki-agent/commit/266662cfee88fc133cef53faf4aaac04a6e9addb))

# [1.58.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.57.0...v1.58.0) (2026-05-31)


### Bug Fixes

* set KASEKI_SCOUTING environment variable to disable scouting during inspection tasks ([9648e35](https://github.com/CyanAutomation/kaseki-agent/commit/9648e35d510664df6548d071722752117647d4d8))
* update message summary to include full content without truncation ([4b2f754](https://github.com/CyanAutomation/kaseki-agent/commit/4b2f754866ee8f2f5437f25695eea64fef1d567f))
* update test to check for correct data-tab attribute for artifacts ([2a08647](https://github.com/CyanAutomation/kaseki-agent/commit/2a086475b96d3c4167eca45d08153ba1ed364c80))


### Features

* enhance issues input with recent repositories dropdown functionality ([c8ab616](https://github.com/CyanAutomation/kaseki-agent/commit/c8ab616f7704ac8a29131ac7eabb4c9afa2f8fef))
* enhance response summary to include progress message with full-width styling ([df8b42c](https://github.com/CyanAutomation/kaseki-agent/commit/df8b42cddafba92b65aeb1e9ac9a5b99ddc26e0c))
* implement full results modal with tabbed navigation for status, events, stdout, and artifacts ([7f4200e](https://github.com/CyanAutomation/kaseki-agent/commit/7f4200e7c986de580e020e6b19f2811a8aec66cb))
* introduce display names for progress stages and enhance structured progress handling ([127ebd2](https://github.com/CyanAutomation/kaseki-agent/commit/127ebd20ac7b77162950eb34493d7d4a07055631))

# [1.57.0](https://github.com/CyanAutomation/kaseki-agent/compare/v1.56.2...v1.57.0) (2026-05-31)


### Features

* Implement code changes to enhance functionality and improve performance ([67f006e](https://github.com/CyanAutomation/kaseki-agent/commit/67f006e75ffe037380da345cbb4c901f8bace598))

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
