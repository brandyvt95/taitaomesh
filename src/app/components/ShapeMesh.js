'use client'

import * as THREE from 'three'
import React, { useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'

// Hàm tìm contour của shape từ bitmap
function findContour(imageData, width, height) {
  const visited = new Set()
  const contours = []
  
  // Helper function để check pixel có phải white không
  const isWhite = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return false
    const i = (y * width + x) * 4
    const r = imageData[i]
    const g = imageData[i + 1] 
    const b = imageData[i + 2]
    return r > 200 && g > 200 && b > 200
  }
  
  // Tìm edge pixels (white pixel có ít nhất 1 neighbor đen)
  const edgePixels = []
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (isWhite(x, y)) {
        // Check 8 neighbors
        let hasBlackNeighbor = false
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            if (!isWhite(x + dx, y + dy)) {
              hasBlackNeighbor = true
              break
            }
          }
          if (hasBlackNeighbor) break
        }
        if (hasBlackNeighbor) {
          edgePixels.push({ x, y })
        }
      }
    }
  }
  
  if (edgePixels.length === 0) return []
  
  // Sắp xếp edge pixels theo góc để tạo contour
  const center = edgePixels.reduce((acc, p) => ({
    x: acc.x + p.x,
    y: acc.y + p.y
  }), { x: 0, y: 0 })
  center.x /= edgePixels.length
  center.y /= edgePixels.length
  
  edgePixels.sort((a, b) => {
    const angleA = Math.atan2(a.y - center.y, a.x - center.x)
    const angleB = Math.atan2(b.y - center.y, b.x - center.x)
    return angleA - angleB
  })
  
  return edgePixels
}

// Hook để tạo geometry từ image
function useShapeGeometryFromImage(url, resolution = 1, extrude = 0.1) {
  const [geometry, setGeometry] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!url) return
    
    setLoading(true)
    setError(null)
    
    const img = new Image()
    img.crossOrigin = 'anonymous'
    
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        canvas.width = img.width
        canvas.height = img.height
        ctx.drawImage(img, 0, 0)
        const imgData = ctx.getImageData(0, 0, img.width, img.height)
        
        // Tìm contour
        const contour = findContour(imgData.data, img.width, img.height)
        
        if (contour.length < 3) {
          setError('Không tìm thấy shape hợp lệ')
          setLoading(false)
          return
        }
        
        // Convert contour points sang Vector2 và normalize
        const points = contour
          .filter((_, i) => i % resolution === 0) // Downsample
          .map(p => new THREE.Vector2(
            (p.x / img.width - 0.5) * 2,   // normalize về [-1, 1]
            -(p.y / img.height - 0.5) * 2  // flip Y và normalize
          ))
        
        // Tạo shape
        const shape = new THREE.Shape(points)
        
        // Tạo geometry - có thể flat hoặc extrude
        let geo
        if (extrude > 0) {
          // ExtrudeGeometry cho 3D
          const extrudeSettings = {
            depth: extrude,
            bevelEnabled: false
          }
          geo = new THREE.ExtrudeGeometry(shape, extrudeSettings)
        } else {
          // ShapeGeometry cho flat
          geo = new THREE.ShapeGeometry(shape)
        }
        
        geo.computeVertexNormals()
        geo.computeBoundingBox()
        
        setGeometry(geo)
        setLoading(false)
        
      } catch (err) {
        setError('Lỗi xử lý image: ' + err.message)
        setLoading(false)
      }
    }

    img.onerror = () => {
      setError('Không thể load image')
      setLoading(false)
    }

    img.src = url
  }, [url, resolution, extrude])

  return { geometry, loading, error }
}

// Component mesh
function ShapeMesh({ url, resolution = 2, extrude = 0.1, color = "white" }) {
  const { geometry, loading, error } = useShapeGeometryFromImage(url, resolution, extrude)

  if (loading) return <mesh><boxGeometry args={[0.1, 0.1, 0.1]} /><meshBasicMaterial color="gray" /></mesh>
  if (error) return <mesh><boxGeometry args={[0.1, 0.1, 0.1]} /><meshBasicMaterial color="red" /></mesh>
  if (!geometry) return null

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial 
        color={color} 
        side={THREE.DoubleSide}
        metalness={0.1}
        roughness={0.3}
      />
    </mesh>
  )
}

// Test component với sample shape
function TestShape() {
  const canvasRef = useRef()
  const [imageUrl, setImageUrl] = useState('/shape2.png') // Dùng image của bạn
  const [useTestShape, setUseTestShape] = useState(false)
  
  useEffect(() => {
    if (useTestShape) {
      // Tạo test image chỉ khi user chọn
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      canvas.width = 200
      canvas.height = 200
      
      // Clear to black
      ctx.fillStyle = 'black'
      ctx.fillRect(0, 0, 200, 200)
      
      // Draw white shape (star)
      ctx.fillStyle = 'white'
      ctx.beginPath()
      const centerX = 100, centerY = 100, radius = 60
      for (let i = 0; i < 10; i++) {
        const angle = (i * Math.PI) / 5
        const r = i % 2 === 0 ? radius : radius * 0.5
        const x = centerX + Math.cos(angle) * r
        const y = centerY + Math.sin(angle) * r
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.fill()
      
      setImageUrl(canvas.toDataURL())
    }
  }, [useTestShape])

  return (
    <div className="w-full h-screen bg-gray-900">
      <div className="absolute top-4 left-4 z-10 text-white">
        <h2 className="text-xl mb-2">3D Shape từ 2D Image</h2>
        <p className="text-sm opacity-75 mb-3">
          • Drag để xoay<br/>
          • Scroll để zoom<br/>
          • Shape được tạo từ contour tracing
        </p>
        <button 
          onClick={() => setUseTestShape(!useTestShape)}
          className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-sm"
        >
          {useTestShape ? 'Dùng image gốc' : 'Test với ngôi sao'}
        </button>
      </div>
      
      <Canvas camera={{ position: [0, 0, 3] }} shadows>
        <color attach="background" args={['#1a1a1a']} />
        
        {/* Lighting */}
        <ambientLight intensity={0.4} />
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
        
        {/* Shape mesh */}
        {imageUrl && (
          <ShapeMesh 
            url={imageUrl} 
            resolution={1} 
            extrude={0.2} 
            color="#4f46e5"
          />
        )}
        
        {/* Ground plane */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1, 0]} receiveShadow>
          <planeGeometry args={[10, 10]} />
          <meshStandardMaterial color="#333" />
        </mesh>
        
        <OrbitControls enableDamping dampingFactor={0.05} />
      </Canvas>
    </div>
  )
}

export default TestShape