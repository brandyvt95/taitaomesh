import * as THREE from 'three'

export function findContourPath_ConvexHull_sm(imageData, width, height) {
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
  
  // THÊM: Simple smooth bằng moving average
  function simpleSmooth(hullPoints, iterations = 2) {
    if (hullPoints.length < 3) return hullPoints
    
    let smoothed = [...hullPoints]
    
    for (let iter = 0; iter < iterations; iter++) {
      const newSmoothed = []
      
      for (let i = 0; i < smoothed.length; i++) {
        const prev = smoothed[(i - 1 + smoothed.length) % smoothed.length]
        const current = smoothed[i]
        const next = smoothed[(i + 1) % smoothed.length]
        
        // Weighted average
        const newX = Math.round(0.5 * current.x + 0.25 * prev.x + 0.25 * next.x)
        const newY = Math.round(0.5 * current.y + 0.25 * prev.y + 0.25 * next.y)
        
        newSmoothed.push({ x: newX, y: newY })
      }
      
      smoothed = newSmoothed
    }
    
    return smoothed
  }
  
  // THÊM: Subdivision smooth (chia nhỏ và làm mượt)
  function subdivisionSmooth(hullPoints, levels = 2) {
    if (hullPoints.length < 3) return hullPoints
    
    let points = [...hullPoints]
    
    for (let level = 0; level < levels; level++) {
      const newPoints = []
      
      for (let i = 0; i < points.length; i++) {
        const current = points[i]
        const next = points[(i + 1) % points.length]
        
        // Thêm điểm hiện tại
        newPoints.push(current)
        
        // Thêm điểm giữa (midpoint)
        const midX = Math.round((current.x + next.x) / 2)
        const midY = Math.round((current.y + next.y) / 2)
        newPoints.push({ x: midX, y: midY })
      }
      
      points = newPoints
    }
    
    // Smooth bằng moving average
    return simpleSmooth(points, 1)
  }
  
  // THÊM: Chaikin's algorithm (proven smooth method)
  function chaikinSmooth(hullPoints, iterations = 2) {
    if (hullPoints.length < 3) return hullPoints
    
    let points = [...hullPoints]
    
    for (let iter = 0; iter < iterations; iter++) {
      const newPoints = []
      
      for (let i = 0; i < points.length; i++) {
        const current = points[i]
        const next = points[(i + 1) % points.length]
        
        // Chaikin's corner cutting: thay mỗi cạnh bằng 2 điểm
        const q1 = {
          x: Math.round(0.75 * current.x + 0.25 * next.x),
          y: Math.round(0.75 * current.y + 0.25 * next.y)
        }
        
        const q2 = {
          x: Math.round(0.25 * current.x + 0.75 * next.x),
          y: Math.round(0.25 * current.y + 0.75 * next.y)
        }
        
        newPoints.push(q1, q2)
      }
      
      points = newPoints
    }
    
    return points
  }
  
  // Lấy convex hull
  const hull = convexHull(edgePixels)
  
  // CHỌN 1 TRONG CÁC CÁCH SAU:
  
  // Cách 1: Không smooth (như code gốc)
  // const finalContour = addPointsOnEdges(hull, 3)
  
  // Cách 2: Simple smooth (an toàn nhất)
  const smoothHull = simpleSmooth(hull, 2)
  const finalContour = smoothHull
  
  // Cách 3: Subdivision smooth (tạo nhiều điểm hơn)
//   const smoothHull = subdivisionSmooth(hull, 1)
//   const finalContour = smoothHull
  
  // Cách 4: Chaikin smooth (proven algorithm)
  // const smoothHull = chaikinSmooth(hull, 2)
  // const finalContour = smoothHull
  
  return finalContour
}


export function extractAlphaToDataTexture(texture) {
  const width = texture.image.width;
  const height = texture.image.height;

  // Create a canvas to extract pixels
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(texture.image, 0, 0);

  // Get image data (RGBA)
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Create new Float32Array for alpha channel
  const alphaData = new Float32Array(width * height * 4); // RGBA, but only alpha used

  for (let i = 0; i < width * height; i++) {
    const a = data[i * 4 + 3] / 255; // Normalize alpha
    alphaData[i * 4 + 0] = a; // Or set all channels to a if needed
    alphaData[i * 4 + 1] = a;
    alphaData[i * 4 + 2] = a;
    alphaData[i * 4 + 3] = 1.0; // Keep full alpha in output
  }

  // Create a DataTexture
  const alphaTexture = new THREE.DataTexture(
    alphaData,
    width,
    height,
    THREE.RGBAFormat,
    THREE.FloatType
  );

  alphaTexture.minFilter = THREE.LinearFilter;
  alphaTexture.magFilter = THREE.LinearFilter;
  alphaTexture.wrapS = THREE.ClampToEdgeWrapping;
  alphaTexture.wrapT = THREE.ClampToEdgeWrapping;
  alphaTexture.needsUpdate = true;

  return alphaTexture;
}

export function extractAlphaDataTextureWithMipmaps(texture) {
  const image = texture.image;
  const width = image.width;
  const height = image.height;

  // Vẽ texture lên canvas
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);

  // Lấy dữ liệu ảnh (RGBA)
  const imgData = ctx.getImageData(0, 0, width, height).data;

  // Tạo mảng lưu alpha channel
  const alphaBuffer = new Uint8Array(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    const alpha = imgData[i * 4 + 3]; // kênh A
    alphaBuffer[i * 4 + 0] = alpha;   // R
    alphaBuffer[i * 4 + 1] = alpha;   // G (optional: có thể để 0)
    alphaBuffer[i * 4 + 2] = alpha;   // B
    alphaBuffer[i * 4 + 3] = 255;     // A full
  }

  // Tạo DataTexture
  const alphaTexture = new THREE.DataTexture(alphaBuffer, width, height, THREE.RGBAFormat);
  alphaTexture.minFilter = THREE.LinearMipMapLinearFilter; // hỗ trợ mipmap
  alphaTexture.magFilter = THREE.LinearFilter;
  alphaTexture.generateMipmaps = true;
  alphaTexture.needsUpdate = true;

  return alphaTexture;
}