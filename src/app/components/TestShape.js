import React, { useEffect, useRef, useState } from "react";
import { useLoader } from "@react-three/fiber";
import * as THREE from "three";
import concaveman from "concaveman";
import { Center, Line, useTexture } from "@react-three/drei";
function normalizePoints(points) {
  const xs = points.map(p => p[0]);
  const ys = points.map(p => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  // Scale giữ tỉ lệ đúng
  const scale = Math.max(rangeX, rangeY);

  return points.map(([x, y]) => {
    const nx = ((x - minX) / scale) * 2 - (rangeX / scale);
    const ny = ((y - minY) / scale) * 2 - (rangeY / scale);
    return new THREE.Vector3(nx, -ny, 0);
  });
}

export function TestShape({ url }) {
  const [highResHull, setHighResHull] = useState([]);
  const [lowResHull, setLowResHull] = useState([]);
  const image = useLoader(THREE.TextureLoader, url);
  const texture = useTexture(url)

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = url;

    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      const points = [];

      for (let y = 0; y < canvas.height; y += 2) {
        for (let x = 0; x < canvas.width; x += 2) {
          const i = (y * canvas.width + x) * 4;
          const alpha = data[i + 3];
          if (alpha > 10) {
            points.push([x, y]);
          }
        }
      }

      const highHull = concaveman(points, 1); // chi tiết cao
      const lowHull = concaveman(points, 10); // chi tiết thấp

      setHighResHull(highHull);
      setLowResHull(lowHull);
    };
  }, [url]);

  return (
    <>
      <axesHelper args={[1000]} />

        <group >


          <RenderPoints posZ={0} size={5} points={lowResHull} color="green" boundImg={{x:500,y:500}}/>
          <RenderPoints posZ={0} size={1} points={highResHull} color="red" boundImg={{x:500,y:500}}/>

          <RenderLine posZ={0} points={lowResHull} color="blue"  boundImg={{x:500,y:500}}/>

        </group>
    
  
    
      <RenderImg url={url} />
    </>
  );
}
function centerPointsWithImageSize(points, width, height) {
  const centerX = width / 2;
  const centerY = height / 2;

  return points.map(([x, y]) => new THREE.Vector3(x - centerX, -(y - centerY), 0));
}

function RenderImg({ url, posZ = 0 }) {
  const texture = useTexture(url)
  return (
    <group position={[0, 0, posZ]}>
      <mesh>
        <planeGeometry args={[texture.source.data.naturalWidth, texture.source.data.naturalHeight]} />
        <meshBasicMaterial map={texture} transparent alphaTest={0.01}/>
      </mesh>
    </group>

  );
}

function RenderPoints({ points = [], color, posZ, size,boundImg }) {
  if (!points || points.length < 2) return null;
  //const vertices = points.map(([x, y]) => new THREE.Vector3(x, y, 0));
  //const vertices = normalizePoints(points);
  const vertices = centerPointsWithImageSize(points,boundImg.x,boundImg.y);
  const geom = new THREE.BufferGeometry().setFromPoints(vertices);

  return (
    <group position={[0, 0, posZ]}>
      <points >
        <primitive object={geom} attach="geometry" />
        <pointsMaterial attach="material" color={color} size={size} transparent opacity={1} sizeAttenuation={true}/>
      </points>
    </group>

  );
}


function RenderLine({ points = [], color, closed = true, posZ,boundImg }) {
  if (!points || points.length < 2) return null;
 // const vertices = points.map(([x, y]) => new THREE.Vector3(x, y, 0));
  // const vertices = normalizePoints(points);
    const vertices = centerPointsWithImageSize(points,boundImg.x,boundImg.y);
  const finalPoints = closed ? [...vertices, vertices[0]] : vertices;

  return (
    <group position={[0, 0, posZ]}>
      <Line
        points={finalPoints}
        color={color}
        lineWidth={1}
      />
    </group>

  );
}
