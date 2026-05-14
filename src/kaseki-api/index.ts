/**
 * Public API for kaseki-api module
 *
 * Exports:
 * - SetupOrchestrator: Node version validation + template initialization
 * - ServiceBootstrapper: Component initialization + graceful shutdown
 */

export { initializeSetup, type SetupContext } from './setup-orchestrator';
export {
  bootstrapServices,
  gracefulShutdown,
  type BootstrappedServices,
  type ShutdownDeps,
} from './service-bootstrapper';
