import * as THREE from "three";
import { Lensflare, LensflareElement } from "three/addons/objects/Lensflare.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { resizeRendererToDisplaySize, loadShader } from "./util";
import { createNoise2D } from "simplex-noise";
import alea from "alea";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import vertexShader from "./shaders/waterVertexShader.glsl";
import fragmentShader from "./shaders/waterFragmentShader.glsl";
import { Sky } from "three/addons/objects/Sky.js";

let scene, camera, renderer, controls, clock, renderTarget;
let waterMesh, waterMaterial, depthMaterial;
let terrainMaterial;
let me;
let shadowMatrix, shadowMapRenderTarget;
let directionalLight, lightHelper;
let dirLightShadowMap;

const textureLoader = new THREE.TextureLoader();
const textureFlare0 = textureLoader.load("/lensflare.jpg");
const lensflare = new Lensflare();
lensflare.addElement(new LensflareElement(textureFlare0, 512, 0));

const prng = alea("flamengo");
const noise2D = createNoise2D(prng);

async function main() {
  clock = new THREE.Clock();
  const canvas = document.querySelector("#canvas");
  renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  scene = new THREE.Scene();
  camera = createCamera();
  controls = createControls();

  renderTarget = createDepthRenderTarget();
  createSceneObjects();
  requestAnimationFrame(render);
}

function render() {
  const time = clock.getElapsedTime();
  updateRendererSize();
  captureSceneDepth();

  updateWaterMaterialUniforms(time);

  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

function generateTerrain(width, height, noise) {
  const geometry = new THREE.PlaneGeometry(width, height, 750, 750);
  const vertices = geometry.attributes.position.array;

  const scale = 0.04;
  const heightFactor = 1.5;
  const stretchFactor = 2.5;

  const windDirection = new THREE.Vector2(1, -3).normalize();
  const cosA = windDirection.x;
  const sinA = windDirection.y;

  for (let i = 0; i < vertices.length; i += 3) {
    let x = vertices[i] * scale;
    let y = vertices[i + 1] * scale;

    // Rotaciona as coordenadas para alinhar o noise com o vento
    let xAligned = x * cosA - y * sinA;
    let yAligned = x * sinA + y * cosA;

    // Alongamento na direção do vento
    let baseHeight = noise(xAligned, yAligned * stretchFactor);

    let height = baseHeight * heightFactor;

    vertices[i + 2] = height;
  }

  geometry.computeVertexNormals();
  geometry.attributes.position.needsUpdate = true;

  return geometry;
}

// Cria o render target para capturar a profundidade da cena
function createDepthRenderTarget() {
  const target = new THREE.WebGLRenderTarget(
    window.innerWidth,
    window.innerHeight
  );
  target.texture.minFilter = THREE.NearestFilter;
  target.texture.magFilter = THREE.NearestFilter;
  // target.texture.generateMipmaps = true;
  target.depthTexture = new THREE.DepthTexture();
  target.depthTexture.type = THREE.UnsignedShortType;
  return target;
}

function createCamera() {
  const cam = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.01,
    500
  );
  cam.position.set(-25, 10, -4);
  return cam;
}

function createControls() {
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.maxPolarAngle = Math.PI / 2.2;
  controls.update();
  return controls;
}

function createSceneObjects() {
  scene.fog = new THREE.Fog(new THREE.Color(0x9aabc3), 10, 400);
  // scene.background = new THREE.Color(0x9aabc3);
  const sky = new Sky();
  sky.material.uniforms.turbidity.value = 1; // More haze
  sky.material.uniforms.rayleigh.value = 0.1; // Blue scattering
  sky.material.uniforms.mieCoefficient.value = 0.005; // Air particle density
  sky.material.uniforms.mieDirectionalG.value = 0.8; // Sun glow intensity
  renderer.toneMappingExposure = 0.5; // Adjust brightness

  sky.scale.setScalar(450000);
  const phi = THREE.MathUtils.degToRad(65);
  const theta = THREE.MathUtils.degToRad(0);
  const sunPosition = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
  sky.material.uniforms.sunPosition.value = sunPosition;
  scene.add(sky);

  directionalLight = new THREE.DirectionalLight(0xffffff, 5);
  directionalLight.position.set(0, 10, 10);
  directionalLight.shadow.camera.near = 0.1;
  directionalLight.shadow.camera.far = 500;
  directionalLight.shadow.camera.left = -200;
  directionalLight.shadow.camera.right = 200;
  directionalLight.shadow.camera.top = 200;
  directionalLight.shadow.camera.bottom = -200;
  directionalLight.shadow.mapSize.width = 2000;
  directionalLight.shadow.mapSize.height = 2000;
  directionalLight.shadow.bias = -0.0002;
  // directionalLight.add(lensflare);
  directionalLight.castShadow = true;

  const directionalLightHelper = new THREE.DirectionalLightHelper(
    directionalLight
  );
  const directionalLightTarget = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xffffff })
  );
  directionalLightTarget.position.set(0, 2, 0);
  directionalLightTarget.castShadow = true;
  directionalLight.target = directionalLightTarget;

  lightHelper = new THREE.CameraHelper(directionalLight.shadow.camera);
  scene.add(lightHelper);
  scene.add(directionalLightHelper);
  scene.add(directionalLightTarget);
  scene.add(directionalLight);

  shadowMapRenderTarget = new THREE.WebGLRenderTarget(2048, 2048);
  shadowMapRenderTarget.depthTexture = new THREE.DepthTexture();
  shadowMapRenderTarget.depthTexture.type = THREE.FloatType;
  shadowMapRenderTarget.depthTexture.format = THREE.DepthFormat;

  dirLightShadowMap = directionalLight.shadow.map;

  // console.log(
  //   "GENERATE SCENE OBJECTS directionalLight.shadow.map ",
  //   directionalLight.shadow.map
  // );

  // const shadowDebugMaterial = new THREE.MeshBasicMaterial({
  //   map: directionalLight.shadow.map.texture,
  // });
  // const shadowDebugPlane = new THREE.Mesh(
  //   new THREE.PlaneGeometry(5, 5),
  //   shadowDebugMaterial
  // );
  // shadowDebugPlane.position.set(0, 10, 0); // Posicione acima do terreno
  // scene.add(shadowDebugPlane);

  const terrainTexture = new THREE.TextureLoader().load("sand-texture.jpg");
  terrainTexture.wrapS = THREE.RepeatWrapping;
  terrainTexture.wrapT = THREE.RepeatWrapping;
  terrainTexture.repeat.set(100, 100);
  terrainTexture.rotation = Math.PI / 5;

  const terrainGeometry = generateTerrain(1000, 1000, noise2D);

  terrainMaterial = new THREE.MeshStandardMaterial({
    map: terrainTexture,
    fog: true,
    // roughness: 10,
    // metalness: 1,
  });
  terrainMaterial.onBeforeCompile = function (shader) {
    shader.uniforms.uTexture = { value: terrainTexture };
    shader.uniforms.uMinHeight = { value: -0.3 };
    shader.uniforms.uMaxHeight = { value: -0.5 };
    shader.uniforms.uRepeat = { value: new THREE.Vector2(300, 300) };
    shader.uniforms.uRotation = { value: Math.PI / 4 };
    shader.vertexShader = shader.vertexShader.replace(
      `#include <common>`,
      `
        #include <common>
        varying vec2 vUv;
        varying vec3 vPosition;
        varying float vHeight;
      `
    );
    shader.vertexShader = shader.vertexShader.replace(
      `#include <uv_vertex>`,
      `
      #include <uv_vertex>
      vUv = uv;
      vPosition = position;
      vHeight = position.z;
    `
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      `#include <common>`,
      `
        #include <common>
        uniform sampler2D uTexture;
        uniform float uMinHeight;
        uniform float uMaxHeight;
        uniform vec2 uRepeat;
        uniform float uRotation;
        varying vec2 vUv;
        varying float vHeight;
      `
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      `#include <map_fragment>`,
      `
        #include <map_fragment>
        vec2 repeatedUV = vUv * uRepeat;
  
        float cosR = cos(uRotation);
        float sinR = sin(uRotation);
        mat2 rotationMatrix = mat2(cosR, -sinR, sinR, cosR);
  
        vec2 rotatedUV = rotationMatrix * repeatedUV;
        vec4 texColor = texture2D(uTexture, rotatedUV);
  
        float wetFactor = smoothstep(uMaxHeight, uMinHeight, vHeight);
        vec3 darkenedColor = mix(texColor.rgb * (vec3(149, 127, 83) * 0.05) * 0.1, texColor.rgb, wetFactor);
        diffuseColor.rgb = darkenedColor;
      `
    );
  };
  const terrainMesh = new THREE.Mesh(terrainGeometry, terrainMaterial);
  terrainMesh.castShadow = true;
  terrainMesh.receiveShadow = true;
  terrainMesh.rotation.x = -Math.PI / 2;
  scene.add(terrainMesh);


  waterMaterial = new THREE.ShaderMaterial({
    defines: { DEPTH_PACKING: 0, ORTHOGRAPHIC_CAMERA: 0 },
    uniforms: {
      fogColor: { value: new THREE.Color(0x9aabc3) },
      fogNear: { value: 0.0 },
      fogFar: { value: 10.0 },
      time: { value: 0 },
      threshold: { value: 0.0 },
      foamScale: { value: 0.0 },
      thickness: { value: 0.5 },
      tDudv: { value: textureLoader.load("foam-texture.png") },
      tDepth: { value: renderTarget.depthTexture },
      cameraNear: { value: camera.near },
      cameraFar: { value: camera.far },
      resolution: {
        value: new THREE.Vector2(window.innerWidth, window.innerHeight),
      },
      foamColor: { value: new THREE.Color(0x149f75) },
      waterColor: { value: new THREE.Color(0x025b5e) },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    wireframe: false,
    fog: true,
  });

  const waterGeometry = new THREE.PlaneGeometry(1000, 1000, 500, 500);
  waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
  waterMesh.receiveShadow = true;
  waterMesh.castShadow = true;
  waterMesh.rotation.x = -Math.PI * 0.5;
  waterMesh.position.y = -0.5;
  scene.add(waterMesh);

  const loader = new GLTFLoader();
}

function updateRendererSize() {
  if (resizeRendererToDisplaySize(renderer)) {
    camera.aspect =
      renderer.domElement.clientWidth / renderer.domElement.clientHeight;
    camera.updateProjectionMatrix();
  }
}

// Captura a profundidade da cena para os efeitos de água
function captureSceneDepth() {
  waterMesh.visible = false;
  // scene.overrideMaterial = depthMaterial;
  renderer.setRenderTarget(renderTarget);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  scene.overrideMaterial = null;
  waterMesh.visible = true;
}

function updateWaterMaterialUniforms(time) {
  waterMaterial.uniforms.time.value = time;
  waterMaterial.uniforms.tDepth.value = renderTarget.depthTexture;
  waterMaterial.uniforms.tDepth.needsUpdate = true;
}

main();
