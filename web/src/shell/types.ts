export interface ModulePage {
  id: string;
  label: string;
  path: string;
}

export interface ModuleAction {
  id: string;
  label: string;
  description: string;
  keywords?: string[];
  method: "POST";
  path: string;
  successMessage: string;
}

export interface ModuleDescriptor {
  id: string;
  title: string;
  pages: ModulePage[];
  actions: ModuleAction[];
}

export interface ModulesResponse {
  modules: ModuleDescriptor[];
  typeToSearch: boolean;
}

export interface UpdateStatus {
  currentVersion: string;
  update: {
    version: string;
    url: string;
    publishedAt: string | null;
  } | null;
}
