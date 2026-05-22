import { initializeSetup, type SetupContext } from './setup-orchestrator';

type Assert<T extends true> = T;
type IsExact<T, U> = (<G>() => G extends T ? 1 : 2) extends <G>() =>
  G extends U ? 1 : 2
  ? true
  : false;

type InitializedSetupReturn = Awaited<ReturnType<typeof initializeSetup>>;

type _initializeSetupReturnsSetupContext = Assert<
  IsExact<InitializedSetupReturn, SetupContext>
>;

type _setupContextHasExpectedProperties = Assert<
  IsExact<
    keyof SetupContext,
    | 'nodeVersionValid'
    | 'templateInitialized'
    | 'templateDir'
  >
>;

void (0 as unknown as _initializeSetupReturnsSetupContext);
void (0 as unknown as _setupContextHasExpectedProperties);
