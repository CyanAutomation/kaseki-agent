// Public API contract: initializeSetup returns a SetupContext, and the
// kaseki-api barrel export preserves that same SetupContext alias. The stable
// public fields are documented by https://github.com/CyanAutomation/kaseki-agent/pull/842.
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

const initializeSetupReturnsSetupContext: Assert<
  IsAssignable<InitializedSetupReturn, SetupContext>
> = true;

const setupContextHasDocumentedPublicFields: Assert<
  IsExact<
    Pick<SetupContext, keyof ExpectedSetupContextFields>,
    ExpectedSetupContextFields
  >
> = true;

const barrelExportsSetupContextAlias: Assert<
  IsExact<BarrelSetupContext, SetupContext>
> = true;

void initializeSetupReturnsSetupContext;
void setupContextHasDocumentedPublicFields;
void barrelExportsSetupContextAlias;
