'use client'

import * as THREE from 'three'
import React, { useEffect, useRef, useState } from 'react'
import { Canvas, extend, useThree } from '@react-three/fiber'
import { Center, shaderMaterial, useTexture } from '@react-three/drei'
import { useControls } from 'leva'
import { LoopSubdivision } from 'three-subdivide'
import { extractAlphaDataTextureWithMipmaps, extractAlphaToDataTexture, findContourPath_ConvexHull_sm } from './utils'
import { generateNarrowBandSDFSmooth, generateSDFfromDataTexture } from './generateSDFfromDataTexture'
import { createShapeMaskTexture } from './createShapeMaskTexture'
import cdt2d from 'cdt2d'
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';


import concaveman from 'concaveman'
import { createNormalizedPoints } from './visual'

const CustomMaterial = shaderMaterial(
  {
    uTime: 0,
    uColor: new THREE.Color(0xffffff),
    uMap: null,
    uAlphaCheck: null
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
uniform sampler2D uAlphaCheck2;
    
    void main() {
      vUv = uv;
      vNormal = normal;
      
      vec3 pos = position;
    pos.z += .05;
vec4 clr = texture2D(uMap, uv);
vec4 clr2 = texture2D(uAlphaCheck, vUv);
vec4 clr3 = texture2D(uAlphaCheck2, vUv);
float grad = radialGradient(uv); // 0.0 ở tâm -> 1.0 ở rìa

 float direction = sign(position.z); // +1 hoặc -1
    float strengths = 0.6;
   float pushedg = smoothstep(0., 1.0, 1.- clr3.r) * 1.;

    float displacement =  strengths  * (clr2.r / 1.)  ;   //// 
   // pos.z += mix(0.,(1.0 - grad) * .1 * direction ,clr2.r);
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
      vec4 clr = texture2D(uMap, vUv);
      result = clr.rgb;
      if(clr.a < 0.01) {
        result = vec3(1.0);
      }
      gl_FragColor = vec4(result, 1.0);
       //  gl_FragColor = vec4(normalize(vNormal) ,1.);
    }
  `
)
extend({ CustomMaterial })
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
      while (hull.length > 1 && crossProduct(hull[hull.length - 2], hull[hull.length - 1], sorted[i]) <= 0) {
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
  const finalContour = addPointsOnEdges(hull, 15)

  return finalContour
}
function fillDeepConcaveAreas(contour, minDepth = 15, lookAhead = 8) {
  if (contour.length < 3) return contour

  // Tìm tâm của shape bằng cách tính centroid
  const centroid = {
    x: contour.reduce((sum, p) => sum + p.x, 0) / contour.length,
    y: contour.reduce((sum, p) => sum + p.y, 0) / contour.length
  }

  // Phát hiện các vùng lõm sâu với thuật toán chính xác hơn
  const concaveRegions = []

  for (let i = 0; i < contour.length; i++) {
    for (let span = lookAhead; span <= lookAhead * 2; span++) {
      const start = i
      const end = (i + span) % contour.length

      const startPoint = contour[start]
      const endPoint = contour[end]

      // Tính vector từ start đến end
      const chordVector = {
        x: endPoint.x - startPoint.x,
        y: endPoint.y - startPoint.y
      }

      const chordLength = Math.sqrt(chordVector.x ** 2 + chordVector.y ** 2)
      if (chordLength < 10) continue // Bỏ qua nếu chord quá ngắn

      // Tìm điểm lõm sâu nhất
      let maxDepth = 0
      let deepestIndex = -1
      let isInwardConcave = false

      for (let j = 1; j < span; j++) {
        const curr = contour[(start + j) % contour.length]

        // Tính khoảng cách từ điểm hiện tại đến chord (đường thẳng start-end)
        const t = Math.max(0, Math.min(1,
          ((curr.x - startPoint.x) * chordVector.x + (curr.y - startPoint.y) * chordVector.y) /
          (chordLength * chordLength)
        ))

        const projection = {
          x: startPoint.x + t * chordVector.x,
          y: startPoint.y + t * chordVector.y
        }

        const distance = Math.sqrt(
          (curr.x - projection.x) ** 2 +
          (curr.y - projection.y) ** 2
        )

        if (distance > maxDepth) {
          maxDepth = distance
          deepestIndex = (start + j) % contour.length

          // Kiểm tra hướng lõm: so sánh khoảng cách từ tâm
          const chordMidpoint = {
            x: (startPoint.x + endPoint.x) / 2,
            y: (startPoint.y + endPoint.y) / 2
          }

          const distChordToCenter = Math.sqrt(
            (chordMidpoint.x - centroid.x) ** 2 +
            (chordMidpoint.y - centroid.y) ** 2
          )

          const distCurrToCenter = Math.sqrt(
            (curr.x - centroid.x) ** 2 +
            (curr.y - centroid.y) ** 2
          )

          // Nếu điểm lõm gần tâm hơn chord midpoint = lõm vào trong
          isInwardConcave = distCurrToCenter < distChordToCenter
        }
      }

      // Chỉ xử lý nếu đủ sâu và lõm vào trong
      if (maxDepth >= minDepth && isInwardConcave) {
        // Kiểm tra thêm: tính cross product để xác định hướng
        const toDeepest = {
          x: contour[deepestIndex].x - startPoint.x,
          y: contour[deepestIndex].y - startPoint.y
        }

        const crossProduct = chordVector.x * toDeepest.y - chordVector.y * toDeepest.x

        // Cross product âm = lõm vào bên phải (theo chiều kim đồng hồ)
        // Điều chỉnh theo hướng contour của bạn
        const isDefinitelyInward = Math.abs(crossProduct) > chordLength * 2

        if (isDefinitelyInward) {
          concaveRegions.push({
            start: start,
            end: end,
            depth: maxDepth,
            deepestIndex: deepestIndex,
            span: span
          })
        }
      }
    }
  }

  // Loại bỏ các vùng trùng lặp - ưu tiên vùng sâu nhất
  const filteredRegions = []
  concaveRegions.sort((a, b) => b.depth - a.depth)

  for (const region of concaveRegions) {
    let overlap = false
    for (const existing of filteredRegions) {
      const overlapStart = Math.max(region.start, existing.start)
      const overlapEnd = Math.min(region.end, existing.end)
      if (overlapStart < overlapEnd ||
        Math.abs(region.start - existing.start) < lookAhead / 2) {
        overlap = true
        break
      }
    }
    if (!overlap) {
      filteredRegions.push(region)
    }
  }

  // Tạo contour mới với đường cong cosine mượt
  const result = []
  const processedIndices = new Set()

  // Đánh dấu các vùng sẽ bị thay thế
  for (const region of filteredRegions) {
    for (let i = region.start + 1; i < region.end; i++) {
      processedIndices.add(i % contour.length)
    }
  }

  for (let i = 0; i < contour.length; i++) {
    if (!processedIndices.has(i)) {
      result.push(contour[i])

      // Kiểm tra xem có cần thêm đường cong không
      const regionStartingHere = filteredRegions.find(r => r.start === i)
      if (regionStartingHere) {
        const startPoint = contour[regionStartingHere.start]
        const endPoint = contour[regionStartingHere.end]

        // Tạo đường cong cosine mượt
        const steps = Math.max(5, Math.floor(regionStartingHere.span / 3))

        for (let step = 1; step < steps; step++) {
          const t = step / steps

          // Sử dụng hàm cosine để tạo đường cong mượt
          const smoothT = 0.5 * (1 - Math.cos(t * Math.PI))

          // Tính điểm trên đường thẳng
          const linearX = startPoint.x + smoothT * (endPoint.x - startPoint.x)
          const linearY = startPoint.y + smoothT * (endPoint.y - startPoint.y)

          // Thêm một chút lõm vào để không quá thẳng
          const bulge = Math.sin(t * Math.PI) * regionStartingHere.depth * 0.1
          const normal = {
            x: -(endPoint.y - startPoint.y),
            y: endPoint.x - startPoint.x
          }
          const normalLength = Math.sqrt(normal.x ** 2 + normal.y ** 2)

          if (normalLength > 0) {
            normal.x /= normalLength
            normal.y /= normalLength

            result.push({
              x: Math.round(linearX + normal.x * bulge),
              y: Math.round(linearY + normal.y * bulge)
            })
          } else {
            result.push({
              x: Math.round(linearX),
              y: Math.round(linearY)
            })
          }
        }
      }
    }
  }

  return result
}

// Sử dụng:
// const smoothedContour = fillDeepConcaveAreas(contour, 15, 8)
// - minDepth: độ lõm tối thiểu để xử lý (pixel)
// - lookAhead: khoảng cách nhìn trước để phát hiện vùng lõm
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
function smoothGeometry(geometry, iterations = 1, lambda = 0.5) {
  // Input validation
  if (!(geometry instanceof THREE.BufferGeometry) || !geometry.attributes.position) {
    throw new Error('Input must be a THREE.BufferGeometry with a position attribute');
  }

  const positionAttribute = geometry.attributes.position;
  const indices = geometry.index ? geometry.index.array : null;
  const vertexCount = positionAttribute.count;

  // Extract vertices
  const vertices = [];
  for (let i = 0; i < vertexCount; i++) {
    vertices.push(new THREE.Vector3(
      positionAttribute.getX(i),
      positionAttribute.getY(i),
      positionAttribute.getZ(i)
    ));
  }

  // Build adjacency list for vertices
  const adjacency = Array(vertexCount).fill().map(() => []);
  if (indices) {
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i];
      const b = indices[i + 1];
      const c = indices[i + 2];
      adjacency[a].push(b, c);
      adjacency[b].push(a, c);
      adjacency[c].push(a, b);
    }
  } else {
    // Assume triangles from vertex order
    for (let i = 0; i < vertexCount; i += 3) {
      const a = i;
      const b = i + 1;
      const c = i + 2;
      adjacency[a].push(b, c);
      adjacency[b].push(a, c);
      adjacency[c].push(a, b);
    }
  }

  // Laplacian smoothing
  for (let iter = 0; iter < iterations; iter++) {
    const newPositions = vertices.map(v => v.clone());

    for (let i = 0; i < vertexCount; i++) {
      const neighbors = adjacency[i];
      if (neighbors.length === 0) continue; // Skip isolated vertices

      // Compute average position of neighbors
      const avg = new THREE.Vector3();
      neighbors.forEach(n => avg.add(vertices[n]));
      avg.divideScalar(neighbors.length);

      // Update position: lerp between current position and average
      newPositions[i].lerpVectors(vertices[i], avg, lambda);
    }

    // Update vertices
    vertices.forEach((v, i) => {
      positionAttribute.setXYZ(i, v.x, v.y, v.z);
    });
    positionAttribute.needsUpdate = true;
  }

  // Recalculate normals
  geometry.computeVertexNormals();

  return geometry;
}
function smoothContour(points, segments = 100, closed = true) {
  if (points.length < 2) return points

  // Detect dạng dữ liệu
  const isArrayFormat = Array.isArray(points[0])
  const toVec = p => isArrayFormat
    ? new THREE.Vector3(p[0], p[1], 0)
    : new THREE.Vector3(p.x, p.y, 0)

  const curve = new THREE.CatmullRomCurve3(
    points.map(toVec),
    closed,
    'catmullrom',
    0.5
  )

  const smoothPoints = curve.getPoints(segments)

  return smoothPoints.map(p =>
    isArrayFormat ? [p.x, p.y] : { x: p.x, y: p.y }
  )
}

function smoothContour2(contour, smoothness = 5, cornerRadius = 8) {
  if (contour.length < 3) return contour

  // Bước 1: Loại bỏ các điểm trùng lặp và quá gần nhau
  const filtered = []
  for (let i = 0; i < contour.length; i++) {
    const current = contour[i]
    const next = contour[(i + 1) % contour.length]
    const dist = Math.sqrt((next.x - current.x) ** 2 + (next.y - current.y) ** 2)
    if (dist > 1) {
      filtered.push(current)
    }
  }

  if (filtered.length < 3) return contour

  // Bước 2: Phát hiện và làm tròn các góc nhọn
  const smoothed = []

  for (let i = 0; i < filtered.length; i++) {
    const prev = filtered[(i - 1 + filtered.length) % filtered.length]
    const curr = filtered[i]
    const next = filtered[(i + 1) % filtered.length]

    // Tính góc giữa 2 đoạn thẳng
    const v1 = { x: curr.x - prev.x, y: curr.y - prev.y }
    const v2 = { x: next.x - curr.x, y: next.y - curr.y }

    const dot = v1.x * v2.x + v1.y * v2.y
    const mag1 = Math.sqrt(v1.x ** 2 + v1.y ** 2)
    const mag2 = Math.sqrt(v2.x ** 2 + v2.y ** 2)

    if (mag1 === 0 || mag2 === 0) {
      smoothed.push(curr)
      continue
    }

    const angle = Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2))))

    // Nếu góc nhọn hơn 120 độ (2.09 rad), làm tròn
    if (angle < 2.09) {
      const factor = Math.min(cornerRadius, mag1 * 0.3, mag2 * 0.3)

      // Tạo điểm bo tròn
      const p1 = {
        x: curr.x - (v1.x / mag1) * factor,
        y: curr.y - (v1.y / mag1) * factor
      }
      const p2 = {
        x: curr.x + (v2.x / mag2) * factor,
        y: curr.y + (v2.y / mag2) * factor
      }

      // Thêm các điểm tạo cung tròn
      const steps = 3
      for (let j = 0; j <= steps; j++) {
        const t = j / steps
        const x = p1.x * (1 - t) + p2.x * t +
          (curr.x - (p1.x + p2.x) / 2) * Math.sin(t * Math.PI) * 0.5
        const y = p1.y * (1 - t) + p2.y * t +
          (curr.y - (p1.y + p2.y) / 2) * Math.sin(t * Math.PI) * 0.5
        smoothed.push({ x: Math.round(x), y: Math.round(y) })
      }
    } else {
      smoothed.push(curr)
    }
  }

  // Bước 3: Áp dụng moving average để làm mượt thêm
  const result = []
  for (let i = 0; i < smoothed.length; i++) {
    let avgX = 0, avgY = 0
    let count = 0

    for (let j = -smoothness; j <= smoothness; j++) {
      const idx = (i + j + smoothed.length) % smoothed.length
      avgX += smoothed[idx].x
      avgY += smoothed[idx].y
      count++
    }

    result.push({
      x: Math.round(avgX / count),
      y: Math.round(avgY / count)
    })
  }

  return result
}

// Sử dụng:
// const smoothPath = smoothContour(contour, 3, 6)
// - smoothness: độ mượt (1-10), càng cao càng mượt
// - cornerRadius: bán kính bo góc (pixel), càng lớn góc càng tròn
function flipFaceOrderNonIndexed(geometry) {
  const pos = geometry.attributes.position;
  const arr = pos.array;

  for (let i = 0; i < arr.length; i += 9) {
    // Mỗi 9 phần tử là 1 tam giác: [v1(x,y,z), v2(x,y,z), v3(x,y,z)]
    // Đảo v1 và v3 để đổi chiều winding order

    for (let j = 0; j < 3; j++) {
      const tmp = arr[i + j];           // v1
      arr[i + j] = arr[i + 6 + j];      // v3
      arr[i + 6 + j] = tmp;
    }
  }

  pos.needsUpdate = true;
  geometry.computeVertexNormals(); // rất quan trọng!
}

function mirrorGeometry(geometry, axis = 'z', depth = 1) {
  const mirrored = geometry.clone();
  const pos = mirrored.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    if (axis === 'x') {
      pos.setX(i, -pos.getX(i));       // Lật
      pos.setX(i, pos.getX(i) - depth); // Dịch ra xa
    }
    if (axis === 'y') {
      pos.setY(i, -pos.getY(i));
      pos.setY(i, pos.getY(i) - depth);
    }
    if (axis === 'z') {
      pos.setZ(i, -pos.getZ(i));
      pos.setZ(i, pos.getZ(i) - depth);
    }
  }

  pos.needsUpdate = true;

  // Lật mặt tam giác
  // console.log(mirrored.index)
  if (mirrored.index) {
    const index = mirrored.index.array;
    for (let i = 0; i < index.length; i += 3) {
      const tmp = index[i];
      index[i] = index[i + 2];
      index[i + 2] = tmp;
    }
    mirrored.index.needsUpdate = true;
  }
  mirrored.computeVertexNormals();
  return mirrored;
}
function createBridgeGeometry(contour, depth = 1) {
  const geometry = new THREE.BufferGeometry();
  const positions = [];
  const indices = [];

  const isArray = Array.isArray(contour[0]);
  const len = contour.length;

  for (let i = 0; i < len; i++) {
    const curr = isArray ? contour[i] : [contour[i].x, contour[i].y];
    const next = isArray ? contour[(i + 1) % len] : [contour[(i + 1) % len].x, contour[(i + 1) % len].y];

    // 4 điểm: bottom1, bottom2, top1, top2
    const [x1, y1] = curr;
    const [x2, y2] = next;

    // Đặt 2 mặt song song dọc theo trục Z
    const z0 = 0;
    const z1 = depth;

    const baseIndex = positions.length / 3;

    // Bottom face (z0)
    positions.push(x1, y1, z0); // 0
    positions.push(x2, y2, z0); // 1

    // Top face (z1)
    positions.push(x1, y1, z1); // 2
    positions.push(x2, y2, z1); // 3

    // 2 tam giác tạo mặt bên
    indices.push(baseIndex + 0, baseIndex + 2, baseIndex + 1);
    indices.push(baseIndex + 2, baseIndex + 3, baseIndex + 1);
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}

function extractAlphaPointsFromImageData(data, width, height, alphaThreshold = 10) {
  const points = []

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4
      const alpha = data[index + 3]

      if (alpha > alphaThreshold) {
        points.push([x, y]) // hoặc { x, y } nếu bạn thích
      }
    }
  }

  return points
}
function smoothConcavemanResult(contour, minDepth = 20, smoothFactor = 0.3) {
  if (contour.length < 3) return contour

  // Tìm tâm của shape
  const centroid = {
    x: contour.reduce((sum, p) => sum + p.x, 0) / contour.length,
    y: contour.reduce((sum, p) => sum + p.y, 0) / contour.length
  }

  // Tính bán kính trung bình từ tâm để có baseline
  const avgRadius = contour.reduce((sum, p) => {
    return sum + Math.sqrt((p.x - centroid.x) ** 2 + (p.y - centroid.y) ** 2)
  }, 0) / contour.length

  // Phát hiện các vùng lõm sâu
  const concaveRegions = []

  for (let i = 0; i < contour.length; i++) {
    // Thử nhiều khoảng cách khác nhau
    for (let span = 8; span <= 20; span += 2) {
      const start = i
      const end = (i + span) % contour.length

      const startPoint = contour[start]
      const endPoint = contour[end]

      // Tính khoảng cách chord
      const chordLength = Math.sqrt(
        (endPoint.x - startPoint.x) ** 2 +
        (endPoint.y - startPoint.y) ** 2
      )

      if (chordLength < 15) continue // Bỏ qua chord quá ngắn

      // Tìm điểm lõm sâu nhất trong khoảng này
      let maxDepth = 0
      let deepestIndex = -1
      let isInward = false

      for (let j = 1; j < span; j++) {
        const curr = contour[(start + j) % contour.length]

        // Tính khoảng cách từ điểm hiện tại đến chord
        const A = endPoint.y - startPoint.y
        const B = startPoint.x - endPoint.x
        const C = endPoint.x * startPoint.y - startPoint.x * endPoint.y
        const distance = Math.abs(A * curr.x + B * curr.y + C) /
          Math.sqrt(A ** 2 + B ** 2)

        if (distance > maxDepth) {
          maxDepth = distance
          deepestIndex = (start + j) % contour.length

          // Kiểm tra xem có phải lõm vào trong không
          const currRadius = Math.sqrt(
            (curr.x - centroid.x) ** 2 +
            (curr.y - centroid.y) ** 2
          )

          const chordMidRadius = Math.sqrt(
            ((startPoint.x + endPoint.x) / 2 - centroid.x) ** 2 +
            ((startPoint.y + endPoint.y) / 2 - centroid.y) ** 2
          )

          // Nếu điểm lõm gần tâm hơn chord mid và nhỏ hơn bán kính trung bình
          isInward = currRadius < chordMidRadius && currRadius < avgRadius * 0.85
        }
      }

      // Chỉ xử lý nếu đủ sâu và lõm vào trong
      if (maxDepth >= minDepth && isInward) {
        // Kiểm tra thêm bằng cách tính tỷ lệ contour path / chord length
        let pathLength = 0
        for (let j = 0; j < span; j++) {
          const curr = contour[(start + j) % contour.length]
          const next = contour[(start + j + 1) % contour.length]
          pathLength += Math.sqrt(
            (next.x - curr.x) ** 2 +
            (next.y - curr.y) ** 2
          )
        }

        const ratio = pathLength / chordLength
        if (ratio > 1.4) { // Đường path dài hơn chord 40% = lõm
          concaveRegions.push({
            start: start,
            end: end,
            depth: maxDepth,
            ratio: ratio,
            span: span
          })
        }
      }
    }
  }

  // Loại bỏ overlap, ưu tiên vùng sâu nhất
  const filteredRegions = []
  concaveRegions.sort((a, b) => b.depth - a.depth)

  for (const region of concaveRegions) {
    let hasOverlap = false
    for (const existing of filteredRegions) {
      const dist1 = Math.abs(region.start - existing.start)
      const dist2 = Math.abs(region.end - existing.end)
      if (dist1 < 8 || dist2 < 8) {
        hasOverlap = true
        break
      }
    }
    if (!hasOverlap) {
      filteredRegions.push(region)
    }
  }

  // Tạo contour mới với đường cong mượt
  const result = []
  const skipIndices = new Set()

  // Đánh dấu các điểm sẽ bị thay thế
  for (const region of filteredRegions) {
    for (let i = region.start + 1; i < region.end; i++) {
      skipIndices.add(i % contour.length)
    }
  }

  for (let i = 0; i < contour.length; i++) {
    if (!skipIndices.has(i)) {
      result.push(contour[i])

      // Kiểm tra xem có region bắt đầu từ điểm này không
      const region = filteredRegions.find(r => r.start === i)
      if (region) {
        const startPoint = contour[region.start]
        const endPoint = contour[region.end]

        // Tạo đường cong mượt với cosine interpolation
        const steps = Math.max(6, Math.floor(region.span / 4))

        for (let step = 1; step < steps; step++) {
          const t = step / steps

          // Cosine interpolation cho smooth transition
          const smoothT = 0.5 * (1 - Math.cos(t * Math.PI))

          // Điểm trên đường thẳng
          const linearX = startPoint.x + smoothT * (endPoint.x - startPoint.x)
          const linearY = startPoint.y + smoothT * (endPoint.y - startPoint.y)

          // Thêm bulge nhẹ hướng ra ngoài (không lõm vào)
          const bulgeAmount = Math.sin(t * Math.PI) * region.depth * smoothFactor

          // Vector vuông góc với chord, hướng ra ngoài
          const chordVec = {
            x: endPoint.x - startPoint.x,
            y: endPoint.y - startPoint.y
          }
          const normal = {
            x: -chordVec.y,
            y: chordVec.x
          }
          const normalLength = Math.sqrt(normal.x ** 2 + normal.y ** 2)

          if (normalLength > 0) {
            normal.x /= normalLength
            normal.y /= normalLength

            // Kiểm tra hướng normal (phải hướng ra ngoài)
            const testPoint = {
              x: linearX + normal.x * 5,
              y: linearY + normal.y * 5
            }
            const testRadius = Math.sqrt(
              (testPoint.x - centroid.x) ** 2 +
              (testPoint.y - centroid.y) ** 2
            )
            const currentRadius = Math.sqrt(
              (linearX - centroid.x) ** 2 +
              (linearY - centroid.y) ** 2
            )

            // Nếu test point xa tâm hơn = hướng ra ngoài
            if (testRadius < currentRadius) {
              normal.x = -normal.x
              normal.y = -normal.y
            }

            result.push({
              x: Math.round(linearX + normal.x * bulgeAmount),
              y: Math.round(linearY + normal.y * bulgeAmount)
            })
          } else {
            result.push({
              x: Math.round(linearX),
              y: Math.round(linearY)
            })
          }
        }
      }
    }
  }

  return result
}

// Sử dụng:
// const smoothedContour = smoothConcavemanResult(contour, 20, 0.3)
// - minDepth: độ lõm tối thiểu để xử lý (pixel)  
// - smoothFactor: hệ số làm mượt (0.1-0.5, càng cao càng bulge)
function useShapeGeometryFromImage(url, resolution = 1, params) {
  const [geometry, setGeometry] = useState(null)
  const [loading, setLoading] = useState(false)
  const [texshape, setTexShape] = useState(false)
  const { scene } = useThree()
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

        //let  contour = findContourPath(imgData.data, img.width, img.height) 

        const pointsss = extractAlphaPointsFromImageData(imgData.data, img.width, img.height, 0.01)
        let contour = concaveman(pointsss, 1, 5)
        contour = contour.map(([x, y]) => ({ x, y }))
  
        //  contour = smoothConcavemanResult(contour, 20, 0.3)
       
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

        //let simplifiedContour = simplifyContour(contour, resolution)

        let simplifiedContour = smoothContour(contour, 400)

        createNormalizedPoints(simplifiedContour, scene,{position:[-2,0,0]})

        console.log('simplifiedContour', 200, simplifiedContour)


        
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
        const extrude = 10
        let geo, shape
        if (extrude > 0) {

          const extrudeSettings = {
            depth: 0,
            bevelEnabled: false,
            bevelSegments: 2,
            bevelThickness: .1,
            bevelOffset: 0,
            bevelSize: .15,
          }

          // LỌC CHỈ LẤY TAM GIÁC BÊN TRONG SHAPE
          function isTriangleInside(triangle, vertices, contour) {
            const [a, b, c] = triangle;
            const v1 = vertices[a], v2 = vertices[b], v3 = vertices[c];

            // Tính trọng tâm tam giác
            const centroid = {
              x: (v1.x + v2.x + v3.x) / 3,
              y: (v1.y + v2.y + v3.y) / 3
            };

            // Kiểm tra centroid có trong polygon không
            return isPointInPolygon(centroid, contour.map(p => ({ x: p[0], y: p[1] })));
          }

          function isPointInPolygon(point, polygon) {
            let inside = false;
            for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
              if (((polygon[i].y > point.y) !== (polygon[j].y > point.y)) &&
                (point.x < (polygon[j].x - polygon[i].x) * (point.y - polygon[i].y) / (polygon[j].y - polygon[i].y) + polygon[i].x)) {
                inside = !inside;
              }
            }
            return inside;
          }
          function resample(points, step = 1) {
            const newPoints = [];
            for (let i = 0; i < points.length; i++) {
              const p1 = points[i];
              const p2 = points[(i + 1) % points.length];
              const dist = p1.distanceTo(p2);
              const segments = Math.ceil(dist / step);
              for (let j = 0; j < segments; j++) {
                const t = j / segments;
                newPoints.push(new THREE.Vector2(
                  p1.x * (1 - t) + p2.x * t,
                  p1.y * (1 - t) + p2.y * t
                ));
              }
            }
            return newPoints;
          }
          function inflateMesh(geometry, contour, maxHeight = 5) {
            // Input validation
            if (!(geometry instanceof THREE.BufferGeometry) || !geometry.attributes.position) {
              throw new Error('Input must be a THREE.BufferGeometry with a position attribute');
            }
            if (!Array.isArray(contour) || !contour.every(p => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number'))) {
              throw new Error('Contour must be an array of [x, y] number pairs');
            }
            if (contour.length < 3) {
              throw new Error('Contour must have at least 3 points to form a valid polygon');
            }
            if (typeof maxHeight !== 'number' || maxHeight <= 0) {
              throw new Error('maxHeight must be a positive number');
            }

            const contourPoints = contour.map(([x, y]) => new THREE.Vector2(x, y));

            // Compute centroid for more even inflation
            const centroid = new THREE.Vector2(0, 0);
            contourPoints.forEach(p => centroid.add(p));
            centroid.divideScalar(contourPoints.length);

            // Extract vertices
            const positionAttribute = geometry.attributes.position;
            const vertices = [];
            for (let i = 0; i < positionAttribute.count; i++) {
              vertices.push(new THREE.Vector3(
                positionAttribute.getX(i),
                positionAttribute.getY(i),
                positionAttribute.getZ(i)
              ));
            }

            // Check if point is on contour
            function isOnContour(v) {
              const p = new THREE.Vector2(v.x, v.y);
              for (let i = 0; i < contourPoints.length; i++) {
                const a = contourPoints[i];
                const b = contourPoints[(i + 1) % contourPoints.length];
                const ab = b.clone().sub(a);
                const ap = p.clone().sub(a);
                const t = THREE.MathUtils.clamp(ap.dot(ab) / ab.lengthSq(), 0, 1);
                const proj = a.clone().add(ab.multiplyScalar(t));
                if (p.distanceTo(proj) < 1e-5) return true;
              }
              return false;
            }

            // Calculate distance to contour
            function distanceToContour(v) {
              const p = new THREE.Vector2(v.x, v.y);
              let minDist = Infinity;
              for (let i = 0; i < contourPoints.length; i++) {
                const a = contourPoints[i];
                const b = contourPoints[(i + 1) % contourPoints.length];
                const ab = b.clone().sub(a);
                const ap = p.clone().sub(a);
                const t = THREE.MathUtils.clamp(ap.dot(ab) / ab.lengthSq(), 0, 1);
                const proj = a.clone().add(ab.multiplyScalar(t));
                const dist = p.distanceTo(proj);
                if (dist < minDist) minDist = dist;
              }
              return minDist;
            }

            // Compute distances to contour and centroid
            let maxDist = 0;
            const distances = vertices.map(v => {
              if (isOnContour(v)) return 0;
              const d = distanceToContour(v);
              if (d > maxDist) maxDist = d;
              return d;
            });

            // Handle case with no interior vertices
            if (maxDist === 0) {
              console.warn('All vertices on contour; no inflation applied.');
              return geometry.clone();
            }

            // Compute max distance to centroid for normalization
            let maxCentroidDist = 0;
            vertices.forEach(v => {
              if (!isOnContour(v)) {
                const dist = new THREE.Vector2(v.x, v.y).distanceTo(centroid);
                if (dist > maxCentroidDist) maxCentroidDist = dist;
              }
            });

            // Inflate vertices with parabolic function
            const newGeometry = geometry.clone();
            const newPositionAttribute = newGeometry.attributes.position;
            for (let i = 0; i < newPositionAttribute.count; i++) {
              if (isOnContour(vertices[i])) {
                newPositionAttribute.setZ(i, 0);
              } else {
                const d = distances[i];
                const t = Math.min(d / maxDist, 1); // Normalized distance to contour
                const centroidDist = new THREE.Vector2(vertices[i].x, vertices[i].y).distanceTo(centroid);
                const tCentroid = Math.min(centroidDist / maxCentroidDist, 1); // Normalized distance to centroid
                // Combine contour and centroid distances for even inflation
                const tCombined = Math.max(1 - t, tCentroid); // Prioritize centroid distance for interior
                const z = maxHeight * (1 - tCombined * tCombined); // Parabolic curve
                newPositionAttribute.setZ(i, z);
              }
            }
            newPositionAttribute.needsUpdate = true;

            // Recalculate normals
            newGeometry.computeVertexNormals();

            return newGeometry;
          }
          function inflateMesh2(DEPTH_CS, geometry, contour, maxHeight = 5, swellFactor = 0.5, interpolationSteps = 2) {
            // Input validation
            if (!(geometry instanceof THREE.BufferGeometry) || !geometry.attributes.position) {
              throw new Error('Input must be a THREE.BufferGeometry with a position attribute');
            }
            if (!Array.isArray(contour) || !contour.every(p => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number'))) {
              throw new Error('Contour must be an array of [y, z] number pairs');
            }
            if (contour.length < 3) {
              throw new Error('Contour must have at least 3 points to form a valid polygon');
            }

            const contourPoints = contour.map(([y, z]) => new THREE.Vector2(y, z));
            const targetZ = -DEPTH_CS / 2; // Mặt phẳng z = -0.5 có độ phồng cao nhất
            const center = new THREE.Vector3(0, 0, targetZ); // Tâm phồng

            // Extract vertices
            const positionAttribute = geometry.attributes.position;
            const vertices = [];
            for (let i = 0; i < positionAttribute.count; i++) {
              vertices.push(new THREE.Vector3(
                positionAttribute.getX(i),
                positionAttribute.getY(i),
                positionAttribute.getZ(i)
              ));
            }

            // Check if point is on contour (based on y, z)
            function isOnContour(v, tolerance = 1e-4) {
              const p = new THREE.Vector2(v.y, v.z);
              for (let i = 0; i < contourPoints.length; i++) {
                const a = contourPoints[i];
                const b = contourPoints[(i + 1) % contourPoints.length];
                const ab = b.clone().sub(a);
                const ap = p.clone().sub(a);
                const t = THREE.MathUtils.clamp(ap.dot(ab) / ab.lengthSq(), 0, 1);
                const proj = a.clone().add(ab.multiplyScalar(t));
                if (p.distanceTo(proj) < tolerance) return true;
              }
              return false;
            }

            // Tìm khoảng cách z max từ target z trong mesh
            let maxZDistance = 0;
            vertices.forEach(v => {
              if (!isOnContour(v)) {
                const zDist = Math.abs(v.z - targetZ);
                if (zDist > maxZDistance) {
                  maxZDistance = zDist;
                }
              }
            });

            // Handle case with no interior vertices
            if (maxZDistance === 0) {
              console.warn('All vertices on contour or no Z variation; no inflation applied.');
              return geometry.clone();
            }

            // Inflate vertices dựa trên khoảng cách đến z = -0.5 và phồng ra từ tâm
            const newGeometry = geometry.clone();
            const newPositionAttribute = newGeometry.attributes.position;

            for (let i = 0; i < newPositionAttribute.count; i++) {
              const vertex = vertices[i];

              if (isOnContour(vertex)) {
                // Giữ nguyên vertex trên contour
                continue;
              } else {
                const zDistance = Math.abs(vertex.z - targetZ);

                // t = 0 khi ở z = -0.5, t = 1 khi xa z = -0.5 nhất (đảo ngược cho cos)
                const t = Math.min(zDistance / maxZDistance, 1);

                // Inflation factor theo cos (phồng mạnh nhất khi xa z = -0.5)
                const cosT = Math.cos(t * Math.PI / 2); // cos(0) = 1, cos(π/2) = 0
                const inflationFactor = maxHeight * cosT * swellFactor;

                // Tính hướng từ tâm (0,0,targetZ) đến vertex CHỈ TRONG MẶT PHẲNG XY
                const direction2D = new THREE.Vector2(vertex.x - center.x, vertex.y - center.y);

                // Nếu vertex ở đúng tâm trong mặt phẳng XY, sử dụng hướng mặc định
                if (direction2D.length() < 1e-6) {
                  direction2D.set(1, 0); // Hướng mặc định trong XY
                } else {
                  direction2D.normalize();
                }

                const newX = vertex.x + direction2D.x * inflationFactor;
                const newY = vertex.y + direction2D.y * inflationFactor;
                const newZ = vertex.z; // Giữ nguyên Z

                newPositionAttribute.setX(i, newX);
                newPositionAttribute.setY(i, newY);
                newPositionAttribute.setZ(i, newZ);
              }
            }

            newPositionAttribute.needsUpdate = true;

            // Recalculate normals
            newGeometry.computeVertexNormals();

            return newGeometry;
          }

          function mergeGeometries(geometries) {
            let mergedGeometry = new THREE.BufferGeometry();

            let positions = [];
            let normals = [];
            let uvs = [];
            let indices = [];

            let vertexOffset = 0;

            geometries.forEach(geometry => {
              geometry = geometry.clone();
              geometry = geometry.toNonIndexed(); // Chuyển về non-indexed để dễ merge

              const pos = geometry.attributes.position.array;
              const norm = geometry.attributes.normal ? geometry.attributes.normal.array : [];
              const uv = geometry.attributes.uv ? geometry.attributes.uv.array : [];

              for (let i = 0; i < pos.length; i += 3) {
                positions.push(pos[i], pos[i + 1], pos[i + 2]);
              }

              for (let i = 0; i < norm.length; i += 3) {
                normals.push(norm[i], norm[i + 1], norm[i + 2]);
              }

              for (let i = 0; i < uv.length; i += 2) {
                uvs.push(uv[i], uv[i + 1]);
              }

              const vertCount = pos.length / 3;
              for (let i = 0; i < vertCount; i++) {
                indices.push(vertexOffset + i);
              }

              vertexOffset += vertCount;
            });

            mergedGeometry.setAttribute(
              'position',
              new THREE.Float32BufferAttribute(positions, 3)
            );

            if (normals.length > 0) {
              mergedGeometry.setAttribute(
                'normal',
                new THREE.Float32BufferAttribute(normals, 3)
              );
            }

            if (uvs.length > 0) {
              mergedGeometry.setAttribute(
                'uv',
                new THREE.Float32BufferAttribute(uvs, 2)
              );
            }

            mergedGeometry.setIndex(indices);

            return mergedGeometry;
          }

          points = resample(points, 10); // bước 5 đơn vị

          shape = new THREE.Shape(points)
          const contour = points.map(p => [p.x, p.y]);
          const contourIndices = contour.map((_, i) => i);

          const edges = [];
          for (let i = 0; i < contour.length; i++) {
            edges.push([i, (i + 1) % contour.length]);
          }

          const triangles = cdt2d(contour, edges, { exterior: true });
          const vertices = contour.map(([x, y]) => new THREE.Vector3(x, y, 0));

          const insideTriangles = triangles.filter(triangle =>
            isTriangleInside(triangle, vertices, contour)
          );
          // const insideTriangles = triangles
          // THIẾT LẬP ĐỘ DÀY
          const depth = .05 // Điều chỉnh độ dày

          const positions = [];
          const indices = [];
          let vertexIndex = 0;
          // // 2. MẶT SAU (z = -depth) - ĐẢO CHIỀU
          for (const [a, b, c] of insideTriangles) {
            const v1 = [...vertices[a].toArray()];
            const v2 = [...vertices[b].toArray()];
            const v3 = [...vertices[c].toArray()];

            v1[2] = -depth;
            v2[2] = -depth;
            v3[2] = -depth;

            positions.push(...v1, ...v2, ...v3);
            //indices.push(vertexIndex + 2, vertexIndex + 1, vertexIndex);//back
            indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2); //font

            vertexIndex += 3;
          }

          // TẠO GEOMETRY
          geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
          geo.setIndex(indices);
          geo.computeVertexNormals();




          const iterations = 1
          geo = LoopSubdivision.modify(geo, iterations, {
            split: true,
            uvSmooth: false,
            preserveEdges: true,
            flatOnly: true,
            maxTriangles: Infinity,
          })
          let inflatedGeometry = inflateMesh(geo, contour, .1);


          const shapesample = new THREE.Shape(points)
          const matd = new THREE.MeshStandardMaterial({ color: 0x44aa88, wireframe: true, side: THREE.DoubleSide });

          // let sideGeo = createBridgeGeometry(contour, -DEPTH_CS)
          const DEPTH_CS = .1
          let sideGeo = createBridgeGeometry(contour, -DEPTH_CS);
          sideGeo = LoopSubdivision.modify(sideGeo, 1, {
            split: true,
            uvSmooth: false,
            preserveEdges: true,
            flatOnly: true,
            maxTriangles: Infinity,
          })
          sideGeo = inflateMesh2(DEPTH_CS, sideGeo, contour, 0.2);
          //sideGeo = smoothGeometry(sideGeo, 5, 0.9);
          let b_shape_geo = mirrorGeometry(inflatedGeometry, 'z', DEPTH_CS + .072)
          flipFaceOrderNonIndexed(b_shape_geo);
          geo = mergeGeometries([
            inflatedGeometry,
            b_shape_geo
            /* sideGeo */
          ]);
          scene.add(new THREE.Mesh(sideGeo,new THREE.MeshBasicMaterial({color:'white'})))
          geo = LoopSubdivision.modify(geo, 1, {
            split: true,
            uvSmooth: false,
            preserveEdges: true,
            flatOnly: false,
            maxTriangles: Infinity,
          })
          // geo = smoothGeometry(geo, 5, 0.9);
          geo.computeVertexNormals();

          //geo = new THREE.ShapeGeometry(shape2)
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

        const texshapes = createShapeMaskTexture(shape, 512);
        setTexShape(texshapes)

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

  return { geometry, loading, error, texshape }
}
function cleanAlphaPixels(texture, threshold = 0.01, fillColor = [1, 1, 1]) {
  const image = texture.image;
  if (!image) return;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  canvas.width = image.width;
  canvas.height = image.height;

  ctx.drawImage(image, 0, 0);

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    if (alpha < threshold) {
      // Gán RGB thành trắng hoặc fillColor
      data[i] = fillColor[0] * 255;     // R
      data[i + 1] = fillColor[1] * 255; // G
      data[i + 2] = fillColor[2] * 255; // B
      data[i + 3] = 1
    }
  }

  ctx.putImageData(imgData, 0, 0);

  const newTexture = new THREE.Texture(canvas);
  newTexture.needsUpdate = true;

  return newTexture;
}
function useCleanedTexture(url, threshold = 0.01, fillColor = [1, 1, 1]) {
  const rawTexture = useTexture(url);
  const [cleanTexture, setCleanTexture] = useState(null);

  useEffect(() => {
    if (rawTexture?.image) {
      const fixed = cleanAlphaPixels(rawTexture, threshold, fillColor);
      setCleanTexture(fixed);
    }
  }, [rawTexture]);

  return cleanTexture || rawTexture;
}
export default function ShapeMesh_testalo({ url, urlImg, resolution = 1 }) {

  const normalMap = useTexture('fabric.jpg')


  const textureImg = useCleanedTexture(urlImg)
   textureImg.wrapS = THREE.ClampToEdgeWrapping // hoặc THREE.RepeatWrapping
    textureImg.wrapT = THREE.ClampToEdgeWrapping
    textureImg.repeat.set(1, 1) // set > 1 nếu bạn muốn lặp, set = 1 là không lặp
  textureImg.generateMipmaps = false;
  textureImg.encoding = THREE.sRGBEncoding;
  textureImg.colorSpace = THREE.SRGBColorSpace

  textureImg.needsUpdate = true;
  const {
    wireframes
  } = useControls('Model Settings', {
    wireframes: { value: false },
  })
  const { geometry, loading, error, texshape } = useShapeGeometryFromImage(url, 1)
  const settinggg = useControls('monitest',
    {
      useConvex1: { value: true },
      useConvex2_nonsmo: { value: false },
      detectResErr: { value: true },
      wrapConto: { value: true },
      en_lapcian_sm: { value: true }
    }
    , { collapsed: true }
  )

  useEffect(() => {
  }, [texshape])

  if (loading) return <mesh><boxGeometry args={[0.1, 0.1, 0.1]} /><meshBasicMaterial color="gray" /></mesh>
  if (error) return <mesh><boxGeometry args={[0.1, 0.1, 0.1]} /><meshBasicMaterial color="red" /></mesh>
  if (!geometry) return null

  return (
    <>
      <axesHelper args={[5]} />

      <mesh geometry={geometry} castShadow receiveShadow /* material={mat} */>
        {/*   <meshNormalMaterial/> */}
        <meshStandardMaterial
          normalMap={normalMap}
          /* transparent */
          metalness={0.0}              // không phải kim loại
          roughness={0.6}              // hơi mờ, cảm giác mềm 
          color={'white'} toneMapped={true} map={textureImg} side={2} wireframe={wireframes} />
        {/* <meshNormalMaterial side={2}  wireframe={wireframes} /> */}
        {/*  <customMaterial side={2} wireframe={wireframes} ref={shaderRef} uColor={'white'} uAlphaCheck={generateSDFfromDataTexture(texshape)} uAlphaCheck2={cl.current} uMap={textureImg} /> */}
      </mesh>

      <mesh position={[0, 1.5, 0]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial side={2} map={textureImg} transparent />
      </mesh>
      <mesh position={[1, 1.5, 0]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial side={2} map={textureImg} />
      </mesh>
      <mesh position={[1, 1.5, 0]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial side={2} map={generateSDFfromDataTexture(texshape)} />
      </mesh>
        <mesh position={[1, 2.5, 0]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial side={2} map={generateNarrowBandSDFSmooth(texshape,50)} />
      </mesh>
      <mesh position={[0, 2.5, 0]} >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial side={2} map={texshape} />
      </mesh>
    </>
  )
}
