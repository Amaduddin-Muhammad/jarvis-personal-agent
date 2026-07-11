'use client';

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface ThreeVisualizerProps {
  agentState: 'IDLE' | 'THINKING' | 'ACTING' | 'SPEAKING';
  volumeLevel: number; // 0.0 - 1.0 representing live voice volume
}

export default function ThreeVisualizer({ agentState, volumeLevel }: ThreeVisualizerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(agentState);
  const volumeRef = useRef(volumeLevel);

  // Sync refs to avoid re-triggering useEffect
  useEffect(() => {
    stateRef.current = agentState;
  }, [agentState]);

  useEffect(() => {
    volumeRef.current = volumeLevel;
  }, [volumeLevel]);

  useEffect(() => {
    if (!mountRef.current) return;

    const width = mountRef.current.clientWidth || 300;
    const height = mountRef.current.clientHeight || 300;

    // 1. Setup Scene, Camera, and WebGL Renderer
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.z = 250;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mountRef.current.appendChild(renderer.domElement);

    // 2. Add Holographic Orb (Points Particle System)
    const particleCount = 600;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const originalPositions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    const baseColor = new THREE.Color('#3ad6ff'); // Cyan
    const thinkColor = new THREE.Color('#9b51e0'); // Purple
    const speakColor = new THREE.Color('#33ff99'); // Green
    const actColor = new THREE.Color('#ffb84d'); // Amber

    const radius = 60;
    for (let i = 0; i < particleCount; i++) {
      // Uniform distribution on sphere surface
      const theta = THREE.MathUtils.randFloat(0, Math.PI * 2);
      const phi = THREE.MathUtils.randFloat(0, Math.PI);

      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.sin(phi) * Math.sin(theta);
      const z = radius * Math.cos(phi);

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      originalPositions[i * 3] = x;
      originalPositions[i * 3 + 1] = y;
      originalPositions[i * 3 + 2] = z;

      colors[i * 3] = baseColor.r;
      colors[i * 3 + 1] = baseColor.g;
      colors[i * 3 + 2] = baseColor.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Create a glowing circular texture for particles
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.3, 'rgba(255,255,255,0.8)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 16, 16);
    }
    const particleTexture = new THREE.CanvasTexture(canvas);

    const material = new THREE.PointsMaterial({
      size: 4,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      map: particleTexture,
    });

    const particleSystem = new THREE.Points(geometry, material);
    scene.add(particleSystem);

    // 3. Add Concentric Energy Rings
    const ringCount = 3;
    const rings: THREE.LineLoop[] = [];
    const ringMaterial = new THREE.LineBasicMaterial({
      color: 0x3ad6ff,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
    });

    for (let j = 0; j < ringCount; j++) {
      const ringGeo = new THREE.BufferGeometry();
      const points: THREE.Vector3[] = [];
      const ringRadius = radius + 12 * (j + 1);
      const segments = 64;
      for (let k = 0; k <= segments; k++) {
        const theta = (k / segments) * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(theta) * ringRadius, Math.sin(theta) * ringRadius, 0));
      }
      ringGeo.setFromPoints(points);
      const ring = new THREE.LineLoop(ringGeo, ringMaterial);
      
      // Offset starting rotations
      ring.rotation.x = Math.random() * Math.PI;
      ring.rotation.y = Math.random() * Math.PI;
      
      scene.add(ring);
      rings.push(ring);
    }

    // 4. Animation Frame Loop (physics-based morphing)
    let clock = new THREE.Clock();
    let animationId = 0;

    const animate = () => {
      const elapsedTime = clock.getElapsedTime();
      const currentState = stateRef.current;
      const vol = volumeRef.current;

      // Color Interpolation target based on current agentState
      let targetColor = baseColor;
      if (currentState === 'THINKING') targetColor = thinkColor;
      else if (currentState === 'SPEAKING') targetColor = speakColor;
      else if (currentState === 'ACTING') targetColor = actColor;

      // Update particle colors and positions
      const colorsAttr = geometry.attributes.color as THREE.BufferAttribute;
      const positionsAttr = geometry.attributes.position as THREE.BufferAttribute;

      for (let i = 0; i < particleCount; i++) {
        // Color lerp
        colorsAttr.setXYZ(
          i,
          THREE.MathUtils.lerp(colorsAttr.getX(i), targetColor.r, 0.05),
          THREE.MathUtils.lerp(colorsAttr.getY(i), targetColor.g, 0.05),
          THREE.MathUtils.lerp(colorsAttr.getZ(i), targetColor.b, 0.05)
        );

        // Position morphing based on states
        const ox = originalPositions[i * 3];
        const oy = originalPositions[i * 3 + 1];
        const oz = originalPositions[i * 3 + 2];

        let scale = 1.0;

        if (currentState === 'THINKING') {
          // Twisted swirl
          const factor = Math.sin(elapsedTime * 4 + ox * 0.05) * 6;
          positionsAttr.setXYZ(i, ox + factor, oy, oz + factor);
        } else if (currentState === 'SPEAKING') {
          // Spikey frequency fluctuations
          const noise = Math.sin(elapsedTime * 25 + ox * oy * 0.1) * vol * 20;
          scale = 1.0 + (vol * 0.35);
          positionsAttr.setXYZ(i, ox * scale + noise, oy * scale + noise, oz * scale + noise);
        } else if (currentState === 'ACTING') {
          // Vertical data compression
          scale = 1.0 + Math.sin(elapsedTime * 15 + i) * 0.08;
          positionsAttr.setXYZ(i, ox * scale, oy * Math.cos(elapsedTime * 2 + ox) * 0.95, oz * scale);
        } else {
          // Idle breathing
          scale = 1.0 + Math.sin(elapsedTime * 2.5 + ox * 0.02) * 0.04;
          positionsAttr.setXYZ(i, ox * scale, oy * scale, oz * scale);
        }
      }
      colorsAttr.needsUpdate = true;
      positionsAttr.needsUpdate = true;

      // Base rotations
      if (currentState === 'THINKING') {
        particleSystem.rotation.y += 0.04;
        particleSystem.rotation.x += 0.015;
      } else {
        particleSystem.rotation.y += 0.005;
        particleSystem.rotation.x += 0.003;
      }

      // Rotate energy rings
      rings.forEach((ring, index) => {
        const ringSpeed = 0.002 * (index + 1);
        if (currentState === 'THINKING') {
          ring.rotation.x += ringSpeed * 10;
          ring.rotation.y += ringSpeed * 12;
          ring.scale.setScalar(1.0 + Math.sin(elapsedTime * 10) * 0.05);
        } else {
          ring.rotation.x += ringSpeed;
          ring.rotation.y += ringSpeed * 1.5;
          ring.scale.setScalar(1.0 + Math.sin(elapsedTime * 2 + index) * 0.02);
        }
        // Sync ring colors with target
        const ringMat = ring.material as THREE.LineBasicMaterial;
        ringMat.color.lerp(targetColor, 0.05);
      });

      renderer.render(scene, camera);
      animationId = requestAnimationFrame(animate);
    };

    animate();

    // 5. Handle Resize
    const handleResize = () => {
      if (!mountRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    // 6. Cleanup on Unmount
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
      if (mountRef.current && renderer.domElement) {
        try {
          mountRef.current.removeChild(renderer.domElement);
        } catch (e) {}
      }
      geometry.dispose();
      material.dispose();
      particleTexture.dispose();
      ringMaterial.dispose();
      rings.forEach(r => r.geometry.dispose());
      renderer.dispose();
    };
  }, []);

  return <div ref={mountRef} className="w-full h-full min-h-[300px] relative overflow-hidden" />;
}
