'use client'

import * as THREE from 'three'
import React, { useEffect, useRef, useState } from 'react'
import { Canvas, extend } from '@react-three/fiber'
import { Center, shaderMaterial, useTexture } from '@react-three/drei'
import { useControls } from 'leva'
import { LoopSubdivision } from 'three-subdivide'
import { extractAlphaDataTextureWithMipmaps, extractAlphaToDataTexture, findContourPath_ConvexHull_sm } from './utils'
  const CustomMaterial = shaderMaterial(
  {
    uTime: 0,
    uColor: new THREE.Color(0xffffff),
    uMap:null,
    uAlphaCheck:null
  },
  // vertex shader
  /* glsl */`
    varying vec2 vUv;
    varying vec3 vNormal;
// uv: vec2 từ 0.0 đến 1.0
// return: float từ 0.0 (đen) đến 1.0 (trắng)
float radialGradient(vec2 uv) {
    vec2 center = vec2(0.5, 0.5);
    float dist = distance(uv, center); // max dist ~ 0.707
    float maxDist = length(vec2(0.5, 0.5)); // sqrt(0.5^2 + 0.5^2)
    return clamp(dist / maxDist, 0.0, 1.0);
}
    uniform sampler2D uMap;
uniform sampler2D uAlphaCheck;
    
    void main() {
      vUv = uv;
      vNormal = normal;
      
      vec3 pos = position;
   //  pos.z += 0.1 * abs(sin(pos.x * 1.0) * cos(pos.y * 1.0));
// float radius = length(pos.xy); // khoảng cách từ (x, y) tới tâm (0, 0)
// float strength = 0.2; // độ cao phồng
// float smoothness = 2.0; // càng lớn thì càng nhọn, càng nhỏ thì càng mượt

// pos.z += strength * (1.0 - pow(radius, smoothness));

// float freq = 5.0;
// float amp = 0.2;

// pos.z += amp * abs(sin(length(pos.xy) * freq));
// Tính khoảng cách đến tâm (theo XY)

float radius = 1.;
float strength = 0.01;
float dist = length(pos.xy);
//pos.z -= .1 / 2.;
// Nếu trong vùng ảnh hưởng
if (dist < radius) {
    float displacement = sqrt(1.0 - pow(dist / radius, 2.0)) * strength;
//pos.z += displacement * (pos.z >= 0.0 ? 1.0 : -1.0);

}

vec4 clr = texture2D(uMap, uv);
vec4 clr2 = textureLod(uAlphaCheck, vUv,4.);

float grad = radialGradient(uv); // 0.0 ở tâm -> 1.0 ở rìa

// Đẩy ra 2 bên Z, nhưng giữ nguyên những điểm có Z = 0
if (abs(position.z) >= 0.01) {
    float direction = sign(position.z); // +1 hoặc -1
    float strength = 0.12;
    float displacement = (1.0 - grad) * strength;   ////   * clr2.r

    pos.z = position.z + displacement * direction;
    
} else {
    pos.z = position.z; // giữ nguyên nếu z = 0
}


      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `,
  // fragment shader
  /* glsl */`
    uniform vec3 uColor;
    uniform sampler2D uMap;
    varying vec2 vUv;
    varying vec3 vNormal;
uniform sampler2D uAlphaCheck;
    void main() {
  vec2 zoomedUV = (vUv - 0.5) * 1. + 0.5; // 0.8 = scale < 1 => zoom in
vec4 clr = texture2D(uMap, zoomedUV);
vec4 clr2 = textureLod(uAlphaCheck, vUv,4.);
      float lighting = dot(normalize(vNormal), normalize(vec3(0.0, 0.0, 1.0)));
      //if(clr.a == 0.) clr.xyz = vec3(1.);
      gl_FragColor = vec4(clr.xyz ,1.);
       //  gl_FragColor = vec4(normalize(vNormal) ,1.);
    }
  `
)
extend({CustomMaterial})
function findContourPath_ConvexHull(imageData, width, height) {
  const isWhite = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return false
    const i = (y * width + x) * 4
    const a = imageData[i + 3]
    return a > 128
  }
  
  // Tìm edge pixels
  const edgePixels = []
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (isWhite(x, y)) {
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
  
  if (edgePixels.length < 3) return []
  
  // Tính convex hull bằng Graham scan
  function convexHull(points) {
    if (points.length < 3) return points
    
    // Tìm điểm có y nhỏ nhất (leftmost nếu tie)
    let start = points[0]
    for (let i = 1; i < points.length; i++) {
      if (points[i].y < start.y || (points[i].y === start.y && points[i].x < start.x)) {
        start = points[i]
      }
    }
    
    // Sắp xếp theo góc polar
    const sorted = points.filter(p => p !== start)
    sorted.sort((a, b) => {
      const angleA = Math.atan2(a.y - start.y, a.x - start.x)
      const angleB = Math.atan2(b.y - start.y, b.x - start.x)
      return angleA - angleB
    })
    
    // Graham scan
    const hull = [start, sorted[0]]
    
    for (let i = 1; i < sorted.length; i++) {
      while (hull.length > 1 && crossProduct(hull[hull.length-2], hull[hull.length-1], sorted[i]) <= 0) {
        hull.pop()
      }
      hull.push(sorted[i])
    }
    
    return hull
  }
  
  function crossProduct(o, a, b) {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  }
  
  // Lấy convex hull
  const hull = convexHull(edgePixels)
  
  // Thêm điểm trên các cạnh nối giữa các đỉnh
  function addPointsOnEdges(hullPoints, density = 5) {
    const result = []
    
    for (let i = 0; i < hullPoints.length; i++) {
      const current = hullPoints[i]
      const next = hullPoints[(i + 1) % hullPoints.length]
      
      result.push(current)
      
      // Tính khoảng cách giữa 2 điểm
      const dx = next.x - current.x
      const dy = next.y - current.y
      const distance = Math.sqrt(dx * dx + dy * dy)
      
      // Chỉ thêm điểm nếu khoảng cách đủ lớn
      if (distance > density) {
        const steps = Math.floor(distance / density)
        
        for (let j = 1; j < steps; j++) {
          const t = j / steps
          const interpolatedX = Math.round(current.x + dx * t)
          const interpolatedY = Math.round(current.y + dy * t)
          
          // Kiểm tra điểm interpolated có nằm trên edge không
          if (isWhite(interpolatedX, interpolatedY)) {
            // Kiểm tra có edge neighbor không
            let hasBlackNeighbor = false
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue
                if (!isWhite(interpolatedX + dx, interpolatedY + dy)) {
                  hasBlackNeighbor = true
                  break
                }
              }
              if (hasBlackNeighbor) break
            }
            
            if (hasBlackNeighbor) {
              result.push({ x: interpolatedX, y: interpolatedY })
            }
          }
        }
      }
    }
    
    return result
  }
  
  // Thêm điểm trên cạnh
  const finalContour = addPointsOnEdges(hull, 3)
  
  return finalContour
}

// Cách sử dụng thay thế trong code của bạn:
// const contour = findContourPath_ConvexHull(imgData.data, img.width, img.height)

// Improved contour tracing using Moore boundary tracing algorithm
function findContourPath(imageData, width, height) {
  const isWhite = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return false
    const i = (y * width + x) * 4
    const a = imageData[i + 3] // Alpha channel
    return a > 128 // Threshold for transparency
  }

  // Tìm starting point (first white pixel from top-left)
  let startX = -1, startY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isWhite(x, y)) {
        // Tìm edge pixel (có ít nhất 1 neighbor không phải white)
        let isEdge = false
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            if (!isWhite(x + dx, y + dy)) {
              isEdge = true
              break
            }
          }
          if (isEdge) break
        }
        if (isEdge) {
          startX = x
          startY = y
          break
        }
      }
    }
    if (startX !== -1) break
  }

  if (startX === -1) return []

  // Moore boundary tracing
  const contour = []
  const directions = [
    [0, -1], [1, -1], [1, 0], [1, 1],
    [0, 1], [-1, 1], [-1, 0], [-1, -1]
  ]

  let currentX = startX
  let currentY = startY
  let currentDir = 0 // Start direction

  do {
    contour.push({ x: currentX, y: currentY })

    // Tìm next boundary pixel
    let found = false
    for (let i = 0; i < 8; i++) {
      const dir = (currentDir + i) % 8
      const nextX = currentX + directions[dir][0]
      const nextY = currentY + directions[dir][1]

      if (isWhite(nextX, nextY)) {
        currentX = nextX
        currentY = nextY
        currentDir = (dir + 6) % 8 // Turn left
        found = true
        break
      }
    }

    if (!found) break

    // Avoid infinite loop
    if (contour.length > width * height) break

  } while (!(currentX === startX && currentY === startY) && contour.length < 10000)

  return contour
}
function findContourPath_2(imageData, width, height) {
  const visited = new Set()
  const contours = []
  
  // Helper function để check pixel có phải white không
  const isWhite = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return false
    const i = (y * width + x) * 4
    const r = imageData[i]
    const g = imageData[i + 1] 
    const b = imageData[i + 2]
        const a = imageData[i + 3]
    return a > 128
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
function smoothContour(points, segments = 100, closed = true) {
  if (points.length < 2) return points

  const curve = new THREE.CatmullRomCurve3(
    points.map(p => new THREE.Vector3(p.x, p.y, 0)),
    closed,
    'catmullrom',
    0.5 // tension, 0.5 là tiêu chuẩn
  )

  const smoothPoints = curve.getPoints(segments)

  // Convert lại về mảng {x, y}
  return smoothPoints.map(p => ({ x: p.x, y: p.y }))
}
function inflateZLikeSphere(geometry, strength = 1) {
  const posAttr = geometry.attributes.position

  // Tìm bán kính lớn nhất từ (0,0)
  let maxRadius = 0
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i)
    const y = posAttr.getY(i)
    const r = Math.sqrt(x * x + y * y)
    if (r > maxRadius) maxRadius = r
  }

  // Inflate đối xứng lên và xuống theo Z
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i)
    const y = posAttr.getY(i)
    const r = Math.sqrt(x * x + y * y)
    const normalizedR = r / maxRadius

    // Paraboloid shape (giống nửa sphere): peak ở r=0, 0 tại r=max
    const zOffset = (1 - normalizedR ** 2) * strength

    const currentZ = posAttr.getZ(i)
    // Inflate đối xứng từ Z=0
    const sign = currentZ >= 0 ? 1 : -1
    posAttr.setZ(i, zOffset * sign)
  }

  posAttr.needsUpdate = true
  geometry.computeVertexNormals()
}


// Improved geometry creation with proper triangulation
function useShapeGeometryFromImage(url, resolution = 1) {
  const [geometry, setGeometry] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const {
    extrude,
    depth,
    bevelEnabled,
    bevelSegments,
    bevelThickness,
  } = useControls('Extrude Settings', {
    extrude: { value: 1, min: 0, max: 5, step: 0.1 },
    depth: { value: 0.1, min: 0, max: 1, step: 0.01 },
    bevelEnabled: { value: true },
    bevelSegments: { value: 50, min: 1, max: 50, step: 1 },
    bevelThickness: { value: 0.3, min: 0, max: 1, step: 0.01 }
  })




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

        // Trace contour path
        const contour = findContourPath(imgData.data, img.width, img.height)

        if (contour.length < 3) {
          setError('Không tìm thấy contour hợp lệ')
          setLoading(false)
          return
        }

        // Simplify contour (Douglas-Peucker algorithm simplified)
        const simplifyContour = (points, tolerance = 2) => {
          if (points.length <= 2) return points

          const simplified = [points[0]]
          let lastAdded = 0

          for (let i = 1; i < points.length; i++) {
            const dx = points[i].x - points[lastAdded].x
            const dy = points[i].y - points[lastAdded].y
            const dist = Math.sqrt(dx * dx + dy * dy)

            if (dist > tolerance || i === points.length - 1) {
              simplified.push(points[i])
              lastAdded = i
            }
          }

          return simplified
        }

       let simplifiedContour = simplifyContour(contour, resolution)

simplifiedContour = smoothContour(simplifiedContour, 72)

// Convert to THREE.Vector2 và normalize
let points = simplifiedContour.map(p => new THREE.Vector2(
  (p.x / img.width - 0.5) * 2,
  -(p.y / img.height - 0.5) * 2
))

// Đảm bảo polygon khép kín
if (!points[0].equals(points[points.length - 1])) {
  points.push(points[0].clone())
}
// Đảm bảo winding order đúng
if (THREE.ShapeUtils.isClockWise(points)) {
  points.reverse()
}
   //console.log(points)
// Tạo shape
const shape = new THREE.Shape(points)

        // Create geometry
        let geo
        if (extrude > 0) {
          const length = 12, width = 8;

          const shape2 = new THREE.Shape();
          shape2.moveTo( 0,0 );
          shape2.lineTo( 0, width );
          shape2.lineTo( length, width );
          shape2.lineTo( length, 0 );
          shape2.lineTo( 0, 0 );


          const extrudeSettings = {
            depth:0,
            bevelEnabled: true,
             bevelSegments: 2,
             bevelThickness: .05,
            bevelOffset:0,
             bevelSize: .15,
          }

     

          geo = new THREE.ExtrudeGeometry(shape, extrudeSettings)

 
//geo = geo.toNonIndexed()
 //inflateZLikeSphere(geo, .2)
// Áp dụng subdivision
const iterations = 2
geo = LoopSubdivision.modify(geo, iterations, {
  split: true,
  uvSmooth: false,
  preserveEdges: false,
  flatOnly: false,
  maxTriangles: Infinity,
})


  
         // geo = new THREE.ShapeGeometry(shape2)
        } else {
          geo = new THREE.ShapeGeometry(shape)
        }

        // Proper UV mapping
        const position = geo.attributes.position
        const uv = new Float32Array(position.count * 2)

        for (let i = 0; i < position.count; i++) {
          const x = position.getX(i)
          const y = position.getY(i)

          // Map từ world space [-1,1] về UV space [0,1]
          uv[i * 2] = (x + 1) / 2
          uv[i * 2 + 1] = (y + 1) / 2
        }

        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
        geo.computeVertexNormals()
        geo.computeBoundingBox()

        setGeometry(geo)
        setLoading(false)

      } catch (err) {
        setError('Lỗi xử lý image: ' + err.message)
        setLoading(false)
        console.error('Shape processing error:', err)
      }
    }

    img.onerror = () => {
      setError('Không thể load image')
      setLoading(false)
    }

    img.src = url
  }, [url, resolution])

  return { geometry, loading, error }
}
// Component mesh
export default function ShapeMesh({ url,urlImg, resolution = 1 }) {
  const { geometry, loading, error } = useShapeGeometryFromImage(url, resolution)
  const textureImg = useTexture(urlImg)

  const {
    wireframes
  } = useControls('Model Settings', {
    wireframes: { value: false },
  })


  const shaderRef = useRef()
const al = useRef()
const originalTexture = new THREE.TextureLoader().load(url, (tex) => {
  al.current = extractAlphaDataTextureWithMipmaps(tex);
//console.log(al.current)
});


  if (loading) return <mesh><boxGeometry args={[0.1, 0.1, 0.1]} /><meshBasicMaterial color="gray" /></mesh>
  if (error) return <mesh><boxGeometry args={[0.1, 0.1, 0.1]} /><meshBasicMaterial color="red" /></mesh>
  if (!geometry) return null

  return (
    <>
  {/*   <axesHelper args={[5]}/> */}
 {/*     <Center> */}
       <mesh geometry={geometry} castShadow receiveShadow>
         <customMaterial   wireframe={wireframes} ref={shaderRef} uColor={'white'} uAlphaCheck={al.current} uMap={textureImg}/>
      </mesh>
{/*       </Center> */}

      <mesh position={[0, 2, 0]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={textureImg} />
      </mesh>
    </>
  )
}
