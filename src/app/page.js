'use client';

import { useState } from 'react';

import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import ShapeMesh from './components/ShapeMesh';
import ShapeMesh_testalo from './components/ShapeMesh_testalo';
import { useControls } from 'leva';

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
  const {toggle} = useControls('gen mesh - lapcian + CTD _ buffer',{
    toggle:{value:false}
  })
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
        <Canvas camera={{ position: [0, 0, 3] }} shadows>
          <color attach="background" args={['#1a1a1a']} />
          {toggle ? (
            <>
             <group position={[0,0,0]}>
            <ShapeMesh_testalo  url={'/shape2.png'} urlImg={'/shape.jpg'}/>
          </group>
          <group position={[4,0,0]}>
            <ShapeMesh_testalo url={'/shape3.png'} urlImg={'/shape3o.jpg'}/>
          </group>
          <group position={[-4,0,0]}>
            <ShapeMesh_testalo url={'/shape4.png'} urlImg={'/shape4o.jpg'}/>
          </group>
          <group position={[0,0,4]}>
            <ShapeMesh_testalo url={'/shape5.png'} urlImg={'/shape5o.webp'}/>
          </group> 
          <group position={[-4,0,4]}>
            <ShapeMesh_testalo url={'/shape6.png'} urlImg={'/shape6o.webp'}/>
          </group>
            </>
          ):(
            <>
             <group position={[0,0,0]}>
            <ShapeMesh  url={'/shape2.png'} urlImg={'/shape.jpg'}/>
          </group>
          <group position={[4,0,0]}>
            <ShapeMesh url={'/shape3.png'} urlImg={'/shape3o.jpg'}/>
          </group>
          <group position={[-4,0,0]}>
            <ShapeMesh url={'/shape4.png'} urlImg={'/shape4o.jpg'}/>
          </group>
          <group position={[0,0,4]}>
            <ShapeMesh url={'/shape5.png'} urlImg={'/shape5o.webp'}/>
          </group> 
          <group position={[-4,0,4]}>
            <ShapeMesh url={'/shape6.png'} urlImg={'/shape6o.webp'}/>
          </group>
            </>
          )}
         
          {/* Lighting */}
          <ambientLight intensity={1} />
          <directionalLight
            position={[10, 10, 5]}
            intensity={0.8}
            castShadow
            shadow-camera-far={50}
            shadow-camera-left={-10}
            shadow-camera-right={10}
            shadow-camera-top={10}
            shadow-camera-bottom={-10}
          />
          <OrbitControls enableDamping dampingFactor={0.05} />
          {/* Ground plane */}
         {/*  <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1, 0]} receiveShadow>
            <planeGeometry args={[10, 10]} />
            <meshStandardMaterial color="#333" />
          </mesh> */}
        </Canvas>

      </div>

    </main>
  );
}
