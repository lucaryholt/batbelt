export interface ModulePage {
  id: string;
  label: string;
  path: string;
}

export interface ModuleDescriptor {
  id: string;
  title: string;
  pages: ModulePage[];
}

export interface ModulesResponse {
  modules: ModuleDescriptor[];
}
