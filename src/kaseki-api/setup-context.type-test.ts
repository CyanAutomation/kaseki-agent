import { initializeSetup, type SetupContext } from './setup-orchestrator';
import type { SetupContext as BarrelSetupContext } from './index';

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

type _barrelExportsSetupContextAlias = Assert<
  IsExact<BarrelSetupContext, SetupContext>
>;

type _setupContextShape = Assert<
  IsExact<
    SetupContext,
    {
      nodeVersionValid: boolean;
      templateInitialized: boolean;
      templateDir: string;
    }
  >
>;

void (0 as unknown as _initializeSetupReturnsSetupContext);
void (0 as unknown as _setupContextHasExpectedProperties);
void (0 as unknown as _barrelExportsSetupContextAlias);
void (0 as unknown as _setupContextShape);
