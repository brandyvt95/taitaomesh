'use client';

import { useState } from 'react';

import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import ShapeMesh from './components/ShapeMesh';

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
     // Thay imageUrl bằng đường dẫn tới image của bạn
<ShapeMesh 
  url="/shape.jpg" 
  resolution={2}    // Độ chi tiết
  extrude={0.2}     // Độ dày 3D
  color="#4f46e5" 
/>
      </div>
        
    </main>
  );
}
