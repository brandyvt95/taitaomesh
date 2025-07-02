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
