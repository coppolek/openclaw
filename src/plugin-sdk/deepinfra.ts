import type { ModelDefinitionConfig, ModelProviderConfig } from "./provider-model-shared.js";
import {
  createLazyFacadeArrayValue,
  loadBundledPluginPublicSurfaceModuleSync,
} from "./facade-runtime.js";

type FacadeModule = {
  buildDeepInfraProvider: () => ModelProviderConfig;
  buildDeepInfraProviderWithDiscovery: () => Promise<ModelProviderConfig>;
  DEEPINFRA_BASE_URL: string;
  DEEPINFRA_DEFAULT_CONTEXT_WINDOW: number;
  DEEPINFRA_DEFAULT_MAX_TOKENS: number;
  DEEPINFRA_DEFAULT_MODEL_ID: string;
  DEEPINFRA_DEFAULT_MODEL_REF: string;
  DEEPINFRA_MODEL_CATALOG: ModelDefinitionConfig[];
  DEEPINFRA_MODELS_URL: string;
  discoverDeepInfraModels: () => Promise<ModelDefinitionConfig[]>;
};

function loadFacadeModule(): FacadeModule {
  return loadBundledPluginPublicSurfaceModuleSync<FacadeModule>({
    dirName: "deepinfra",
    artifactBasename: "api.js",
  });
}
export const buildDeepInfraProvider: FacadeModule["buildDeepInfraProvider"] = ((...args) =>
  loadFacadeModule()["buildDeepInfraProvider"](...args)) as FacadeModule["buildDeepInfraProvider"];
export const buildDeepInfraProviderWithDiscovery: FacadeModule["buildDeepInfraProviderWithDiscovery"] =
  ((...args) =>
    loadFacadeModule()["buildDeepInfraProviderWithDiscovery"](
      ...args,
    )) as FacadeModule["buildDeepInfraProviderWithDiscovery"];
export const DEEPINFRA_BASE_URL: FacadeModule["DEEPINFRA_BASE_URL"] =
  loadFacadeModule()["DEEPINFRA_BASE_URL"];
export const DEEPINFRA_DEFAULT_CONTEXT_WINDOW: FacadeModule["DEEPINFRA_DEFAULT_CONTEXT_WINDOW"] =
  loadFacadeModule()["DEEPINFRA_DEFAULT_CONTEXT_WINDOW"];
export const DEEPINFRA_DEFAULT_MAX_TOKENS: FacadeModule["DEEPINFRA_DEFAULT_MAX_TOKENS"] =
  loadFacadeModule()["DEEPINFRA_DEFAULT_MAX_TOKENS"];
export const DEEPINFRA_DEFAULT_MODEL_ID: FacadeModule["DEEPINFRA_DEFAULT_MODEL_ID"] =
  loadFacadeModule()["DEEPINFRA_DEFAULT_MODEL_ID"];
export const DEEPINFRA_DEFAULT_MODEL_REF: FacadeModule["DEEPINFRA_DEFAULT_MODEL_REF"] =
  loadFacadeModule()["DEEPINFRA_DEFAULT_MODEL_REF"];
export const DEEPINFRA_MODEL_CATALOG: FacadeModule["DEEPINFRA_MODEL_CATALOG"] =
  createLazyFacadeArrayValue(
    () => loadFacadeModule()["DEEPINFRA_MODEL_CATALOG"] as unknown as readonly unknown[],
  ) as FacadeModule["DEEPINFRA_MODEL_CATALOG"];
export const DEEPINFRA_MODELS_URL: FacadeModule["DEEPINFRA_MODELS_URL"] =
  loadFacadeModule()["DEEPINFRA_MODELS_URL"];
export const discoverDeepInfraModels: FacadeModule["discoverDeepInfraModels"] = ((...args) =>
  loadFacadeModule()["discoverDeepInfraModels"](
    ...args,
  )) as FacadeModule["discoverDeepInfraModels"];
