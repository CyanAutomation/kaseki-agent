// Public API contract: initializeSetup returns a SetupContext, and the
// kaseki-api barrel export preserves that same SetupContext alias.
import { initializeSetup, type SetupContext } from './setup-orchestrator';
import type { SetupContext as BarrelSetupContext } from './index';

type Assert<T extends true> = T;
type IsAssignable<T, U> = T extends U ? true : false;
type IsExact<T, U> = (<G>() => G extends T ? 1 : 2) extends <G>() =>
  G extends U ? 1 : 2
  ? true
  : false;

type InitializedSetupReturn = Awaited<ReturnType<typeof initializeSetup>>;

type ExpectedSetupContextFields = {
  nodeVersionValid: boolean;
  templateInitialized: boolean;
  templateDir: string;
};

type _initializeSetupReturnsSetupContext = Assert<
  IsAssignable<InitializedSetupReturn, SetupContext>
>;

type _setupContextHasExpectedProperties = Assert<
  IsAssignable<
    ExpectedSetupContextFields,
    Pick<SetupContext, keyof ExpectedSetupContextFields>
  >
>;

type _barrelExportsSetupContextAlias = Assert<
  IsExact<BarrelSetupContext, SetupContext>
>;

type _setupContextIncludesExpectedFields = Assert<
  IsAssignable<SetupContext, ExpectedSetupContextFields>
>;

void (0 as unknown as _initializeSetupReturnsSetupContext);
void (0 as unknown as _setupContextHasExpectedProperties);
void (0 as unknown as _barrelExportsSetupContextAlias);
void (0 as unknown as _setupContextIncludesExpectedFields);
