import * as THREE from 'three';
import concaveman from 'concaveman';
import { useEffect } from 'react';
function detectGaps(hullLowRes, threshold = 0.3) {
  let gapCount = 0;
  let gapDistances = [];

  for (let i = 0; i < hullLowRes.length; i++) {
    let current = hullLowRes[i];
    let next = hullLowRes[(i + 1) % hullLowRes.length];
    
    // Calculate distance between two points using x, y coordinates
    let dx = next[0] - current[0];
    let dy = next[1] - current[1];
    let distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > threshold) {
      gapCount++;
      gapDistances.push(distance);
    }
  }

  console.log(`Number of gap regions: ${gapCount}`);
  console.log(`Gap distances: ${gapDistances.join(', ')}`);
}

function fillDeepGaps(hullFullRes, hullLowRes, depthThreshold = 0.35) {
  let filledPoints = [];
  let maxDepth = 0;

  // Tính max depth cho normalization
  for (let point of hullFullRes) {
    let minDistance = Infinity;
    for (let i = 0; i < hullLowRes.length; i++) {
      let start = hullLowRes[i];
      let end = hullLowRes[(i + 1) % hullLowRes.length];
      let dx = end[0] - start[0];
      let dy = end[1] - start[1];
      let l2 = dx * dx + dy * dy;
      if (l2 === 0) continue;
      let t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / l2));
      let projX = start[0] + t * dx;
      let projY = start[1] + t * dy;
      let dist = Math.sqrt((point[0] - projX) ** 2 + (point[1] - projY) ** 2);
      minDistance = Math.min(minDistance, dist);
    }
    maxDepth = Math.max(maxDepth, minDistance);
  }

  // Xử lý từng điểm trong hullFullRes
  for (let point of hullFullRes) {
    let minDistance = Infinity;
    let bestProjection = null;

    // Tìm projection gần nhất
    for (let i = 0; i < hullLowRes.length; i++) {
      let start = hullLowRes[i];
      let end = hullLowRes[(i + 1) % hullLowRes.length];
      let dx = end[0] - start[0];
      let dy = end[1] - start[1];
      let l2 = dx * dx + dy * dy;
      if (l2 === 0) continue;
      let t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / l2));
      let projX = start[0] + t * dx;
      let projY = start[1] + t * dy;
      let dist = Math.sqrt((point[0] - projX) ** 2 + (point[1] - projY) ** 2);
      if (dist < minDistance) {
        minDistance = dist;
        bestProjection = { x: projX, y: projY, distance: dist, segmentIndex: i, t: t, dx: dx, dy: dy };
      }
    }

    let normalizedDepth = maxDepth > 0 ? minDistance / maxDepth : 0;

    if (normalizedDepth > depthThreshold) {
      // Vùng sâu, suy ra vị trí trên đường cong
      let startPoint = hullLowRes[bestProjection.segmentIndex];
      let endPoint = hullLowRes[(bestProjection.segmentIndex + 1) % hullLowRes.length];
      let steps = Math.max(5, Math.floor(minDistance / 0.05));
      let t = Math.min(1, bestProjection.distance / maxDepth); // Tỷ lệ dựa trên độ sâu

      for (let s = 0; s <= 1; s += 1 / steps) {
        let x = startPoint[0] + s * bestProjection.dx;
        let y = startPoint[1] + s * bestProjection.dy;
        // Đường cong parabol dựa trên độ sâu
        let curveOffset = minDistance * (1 - Math.cos(s * Math.PI)) * (s - s * s);
        let angle = Math.atan2(bestProjection.dy, bestProjection.dx);
        let fillX = x + curveOffset * Math.cos(angle + Math.PI / 2);
        let fillY = y + curveOffset * Math.sin(angle + Math.PI / 2);
        filledPoints.push([fillX, fillY, point[2] || 0]);
      }
    } else {
      // Vùng không sâu, giữ nguyên điểm từ hullFullRes
      filledPoints.push([point[0], point[1], point[2] || 0]);
    }
  }

  console.log('Filled points count:', filledPoints.length);
  return filledPoints;
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


export function TestShape(id,url,urlImg) {
    useEffect(() => {
      if (!url) return
  
   
  
      const img = new Image()
      img.crossOrigin = 'anonymous'
  
      img.onload = () => { 

      }
      img.onerror = () => { 

      }
      
    img.src = url
  }, [url])
   const pointsArray = extractAlphaPointsFromImageData(imgData.data, img.width, img.height, 0.01)
  const points2D = pointsArray.map(p => [p.x, p.y]);
  const concaveHullLow = concaveman(points2D, 50, 0); // concavity = 1, lengthThreshold = 0
  const concaveHullHigh = pointsArray;
  
  const xs = concaveHullHigh.map(p => p.x);
  const ys = concaveHullHigh.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const scale = Math.max(maxX - minX, maxY - minY) / 2 || 1;

  const hullFullRes = concaveHullHigh.map(p => [
    (p.x - cx) / scale,
    (p.y - cy) / scale,
    0
  ]);
  const hullLowRes = concaveHullLow.map(p => [
    p[0],
    p[1],
    0
  ]);

  //detectGaps(hullLowRes)
  let checkIt = fillDeepGaps(hullFullRes, hullLowRes)
  console.log(checkIt)

  let smoothSam = hullFullRes;
 
const vectors = smoothSam.map(p => new THREE.Vector3(p[0], p[1], p[2]));
const curve = new THREE.CatmullRomCurve3(vectors, true);
const smoothPoints = curve.getPoints(150);
smoothSam = smoothPoints.map(v => [v.x, v.y, v.z]);

console.log(vectors,smoothPoints)
  const shapeGeometry = new THREE.BufferGeometry();
  shapeGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(hullLowRes.flat()), 3));
  const shapeMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 3 });
  const shapeLine = new THREE.LineLoop(shapeGeometry, shapeMaterial);
  const pointsGeometry1 = new THREE.BufferGeometry();
  pointsGeometry1.setAttribute('position', new THREE.BufferAttribute(new Float32Array(hullLowRes.flat()), 3));
  const pointsGeometry2 = new THREE.BufferGeometry();
  pointsGeometry2.setAttribute('position', new THREE.BufferAttribute(new Float32Array(hullFullRes.flat()), 3));
    const pointsGeometry3 = new THREE.BufferGeometry();
  pointsGeometry3.setAttribute('position', new THREE.BufferAttribute(new Float32Array(checkIt.flat()), 3));

  const points1 = new THREE.Points(pointsGeometry1, new THREE.PointsMaterial({ color: 'white', size: 0.01, sizeAttenuation: true }));
  const points2 = new THREE.Points(pointsGeometry2, new THREE.PointsMaterial({ color: 'red', size: 5, sizeAttenuation: false }));
   const points3 = new THREE.Points(pointsGeometry3, new THREE.PointsMaterial({ color: 'blue', size: 8, sizeAttenuation: false }));
  const group = new THREE.Group();
  //group.add(shapeLine); 
  group.add(points1); 
  group.position.set(params.position[0], params.position[1], params.position[2]);
  group.rotation.set(Math.PI, 0, 0);

  scene.add(group);

  return {
    points1,
    smoothedShape: shapeLine,
    group,
    hullFullRes,
    hullFullRes
  };
}