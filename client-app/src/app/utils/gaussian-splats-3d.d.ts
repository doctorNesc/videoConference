declare module '@mkkellogg/gaussian-splats-3d' {
  import * as THREE from 'three';

  export const SceneRevealMode: {
    Default: number;
    Gradual: number;
    Instant: number;
  };

  export const SceneFormat: {
    Splat: 0;
    KSplat: 1;
    Ply: 2;
    Spz: 3;
  };

  export interface ViewerOptions {
    rootElement?: HTMLElement | null;
    useBuiltInControls?: boolean;
    selfDrivenMode?: boolean;
    dropInMode?: boolean;
    threeScene?: THREE.Scene;
    camera?: THREE.Camera;
    renderer?: THREE.WebGLRenderer;
    cameraUp?: [number, number, number];
    initialCameraPosition?: [number, number, number];
    initialCameraLookAt?: [number, number, number];
    sceneRevealMode?: number;
    ignoreDevicePixelRatio?: boolean;
    halfPrecisionCovariancesOnGPU?: boolean;
    gpuAcceleratedSort?: boolean;
    sharedMemoryForWorkers?: boolean;
    integerBasedSort?: boolean;
    dynamicScene?: boolean;
    webXRMode?: number;
    renderMode?: number;
    logLevel?: number;
    sphericalHarmonicsDegree?: number;
    enableSIMDInSort?: boolean;
    antialiased?: boolean;
    focalAdjustment?: number;
    identityRMSEThreshold?: number;
    splatSortDistanceMapPrecision?: number;
  }

  export interface AddSplatSceneOptions {
    splatAlphaRemovalThreshold?: number;
    showLoadingUI?: boolean;
    position?: [number, number, number];
    rotation?: [number, number, number, number];
    scale?: [number, number, number];
    progressiveLoad?: boolean;
    streamView?: boolean;
    format?: number;
    onProgress?: (progress: number, progressMessage: string, stage: string) => void;
  }

  export class Viewer {
    constructor(options?: ViewerOptions);
    addSplatScene(path: string, options?: AddSplatSceneOptions): Promise<void>;
    addSplatScenes(scenes: { path: string; options?: AddSplatSceneOptions }[]): Promise<void>;
    start(): void;
    stop(): void;
    dispose(): void;
    update(): void;
    render(): void;
    readonly camera: THREE.Camera;
    readonly renderer: THREE.WebGLRenderer;
    readonly scene: THREE.Scene;
  }
}
