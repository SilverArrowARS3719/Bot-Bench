// The example robot, turning slowly on the homepage. Same parts and loader as the studio.
import * as THREE from 'three';
import { initParts, loadPart, LDU } from './parts.js';
import { parseLdr } from './ldr.js';
import example from '../examples/spike-drive-base.ldr?raw';

const canvas = document.querySelector('#hero-bot');
if (canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xf5b262, 2));
  const sun = new THREE.DirectionalLight(0xfff1e0, 2.2);
  sun.position.set(1, 2, 1.5);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 10);
  const robot = new THREE.Group();
  robot.scale.setScalar(LDU);
  robot.rotation.x = Math.PI; // LDraw is -Y up
  const spin = new THREE.Group();
  spin.add(robot);
  scene.add(spin);

  await initParts();
  await Promise.all(parseLdr(example).map(async r => {
    const part = await loadPart(r.file, r.file === '39367p02.dat' ? '322' : r.color); // azure wheels, like the classic SPIKE base
    const [x, y, z, a, b, c, d, e, f, g, h, i] = r.m;
    part.applyMatrix4(new THREE.Matrix4().set(a, b, c, x, d, e, f, y, g, h, i, z, 0, 0, 0, 1));
    robot.add(part);
  }));
  const box = new THREE.Box3().setFromObject(spin), size = box.getSize(new THREE.Vector3());
  robot.position.sub(box.getCenter(new THREE.Vector3()));
  camera.position.set(0, size.y * 0.9, size.length() * 1.45);
  camera.lookAt(0, 0, 0);

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  renderer.setAnimationLoop(t => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio())) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    spin.rotation.y = still ? -0.6 : t / 4000;
    renderer.render(scene, camera);
  });
}
