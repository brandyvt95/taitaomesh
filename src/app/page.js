'use client';
import * as THREE from 'three'
import { useState } from 'react';

import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import ShapeMesh from './components/ShapeMesh';
import ShapeMesh_testalo from './components/ShapeMesh_testalo';
import { useControls } from 'leva';
import { Perf } from 'r3f-perf';
import { TestShape } from './components/TestShape';

export default function Home() {
  const [image, setImage] = useState(null);
  const [resultUrl, setResultUrl] = useState(null);

  const handleUpload = async () => {
    if (!image) return;

    const formData = new FormData();
    formData.append('image', image);

    const res = await fetch('/api/remove', {
      method: 'POST',
      body: formData,
    });

    if (res.ok) {
      const blob = await res.blob();
      setResultUrl(URL.createObjectURL(blob));
    } else {
      const error = await res.json();
      alert(error.error || 'Failed to process image');
    }
  };
  const { toggle } = useControls('gen mesh - lapcian + CTD _ buffer', {
    toggle: { value: true }
  })

  const shapes = [
 /*    { position: [4, 0, 0], url: '/sa3.png', urlImg: '/s3.jpg' },
    { position: [2, 0, 0], url: '/sa2.png', urlImg: '/s2.jpg' }, */
   /*  { position: [0, 0, 0], url: '/sa4.png', urlImg: '/sa4.png' }, */
    /* { position: [-2, 0, 0], url: '/sa4.png', urlImg: '/sa4.png' },*/
    { position: [0, 0, 0], url: '/sa5.png', urlImg: '/sa5.png' }, 

        { position: [0, 0, 4], url: '/sa6.png', urlImg: '/sa6.png' },
   /*  { position: [-2, 0, 4], url: '/sa7.png', urlImg: '/sa7.png' },
    { position: [-4, 0, 4], url: '/sa8.png', urlImg: '/sa8.png' }, */

  ];


  return (
    <main className="p-8">
      <h1 className="text-2xl mb-4">Remove Background</h1>
      <input type="file" accept="image/*" onChange={(e) => {
        if (e.target.files) setImage(e.target.files[0]);
      }} />
      <button onClick={handleUpload} className="mt-4 px-4 py-2 bg-blue-500 text-white rounded">
        Upload & Remove Background
      </button>

      {resultUrl && (
        <div className="mt-6">
          <h2 className="text-lg mb-2">Result:</h2>
          <img src={resultUrl} alt="Result" className="max-w-md" />
        </div>
      )}
      <div className="w-full h-screen">
        <Canvas camera={{ position: [0, 0, 3] }} shadows
         gl={{
    antialias: false,
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1.8,
  }}
        ><Perf/>
          <color attach="background" args={['#1a1a1a']} />
          {/*  {shapes.map((shape, index) => (
                <group key={index} position={shape.position}>
                  <ShapeMesh_testalo id={index * 2} url={shape.url} urlImg={shape.urlImg} />
                </group>
              ))} */}
          {shapes.map((shape, index) => (
                <group key={index} position={shape.position}>
                  <TestShape id={index * 2} url={shape.url} urlImg={shape.urlImg} />
                </group>
              ))}
          <ambientLight intensity={2} />
          <directionalLight
            position={[10, 10, 5]}
            intensity={2.8}
            castShadow
            shadow-camera-far={50}
            shadow-camera-left={-10}
            shadow-camera-right={10}
            shadow-camera-top={10}
            shadow-camera-bottom={-10}
          />
          <OrbitControls enableDamping dampingFactor={0.05} />
     
         {/*   <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1, 0]} receiveShadow>
            <planeGeometry args={[10, 10]} />
            <meshStandardMaterial color="#333" />
          </mesh> */}
        </Canvas>

      </div>

    </main>
  );
}
