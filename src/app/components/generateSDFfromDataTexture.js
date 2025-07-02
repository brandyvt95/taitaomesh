import * as THREE from 'three';

/**
 * Generate SDF from a binary black & white DataTexture using Jump Flooding Algorithm
 * @param {THREE.DataTexture} binaryTexture - input DataTexture, white=inside, black=outside
 * @param {number} maxDist - maximum distance for normalization
 * @returns {THREE.DataTexture} - SDF texture
 */
export function generateSDFfromDataTexture(binaryTexture, maxDist = 50) {
  const width = binaryTexture.image.width;
  const height = binaryTexture.image.height;
  const inputData = binaryTexture.image.data;

  // Initialize coordinate buffer - stores closest seed point for each pixel
  const coords = new Int32Array(width * height * 2); // [x, y] pairs
  const isInsideBuffer = new Uint8Array(width * height);
  
  function getIndex(x, y) {
    return y * width + x;
  }

  function getInputIndex(x, y) {
    return (y * width + x) * 4;
  }

  function isInside(x, y) {
    const i = getInputIndex(x, y);
    return inputData[i] > 127;
  }

  // Initialize: mark boundary pixels as seeds
  const seeds = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = getIndex(x, y);
      const inside = isInside(x, y);
      isInsideBuffer[idx] = inside ? 1 : 0;
      
      // Check if this is a boundary pixel
      let isBoundary = false;
      if (inside) {
        // Check neighbors for outside pixels
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              if (!isInside(nx, ny)) {
                isBoundary = true;
                break;
              }
            }
          }
          if (isBoundary) break;
        }
      } else {
        // Check neighbors for inside pixels
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              if (isInside(nx, ny)) {
                isBoundary = true;
                break;
              }
            }
          }
          if (isBoundary) break;
        }
      }
      
      if (isBoundary) {
        coords[idx * 2] = x;
        coords[idx * 2 + 1] = y;
        seeds.push({x, y});
      } else {
        coords[idx * 2] = -1; // No seed assigned
        coords[idx * 2 + 1] = -1;
      }
    }
  }

  // Jump Flooding Algorithm
  const maxDimension = Math.max(width, height);
  let step = Math.pow(2, Math.ceil(Math.log2(maxDimension)));
  
  while (step >= 1) {
    const newCoords = new Int32Array(coords);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = getIndex(x, y);
        let bestDist = Infinity;
        let bestX = coords[idx * 2];
        let bestY = coords[idx * 2 + 1];
        
        // Check 9 neighbors at current step distance
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx * step;
            const ny = y + dy * step;
            
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              const nIdx = getIndex(nx, ny);
              const seedX = coords[nIdx * 2];
              const seedY = coords[nIdx * 2 + 1];
              
              if (seedX >= 0 && seedY >= 0) {
                const dist = Math.sqrt((x - seedX) ** 2 + (y - seedY) ** 2);
                if (dist < bestDist) {
                  bestDist = dist;
                  bestX = seedX;
                  bestY = seedY;
                }
              }
            }
          }
        }
        
        newCoords[idx * 2] = bestX;
        newCoords[idx * 2 + 1] = bestY;
      }
    }
    
    coords.set(newCoords);
    step = Math.floor(step / 2);
  }

  // Generate final SDF
  const sdfData = new Float32Array(width * height * 4);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = getIndex(x, y);
      const seedX = coords[idx * 2];
      const seedY = coords[idx * 2 + 1];
      
      let dist = 0;
      if (seedX >= 0 && seedY >= 0) {
        dist = Math.sqrt((x - seedX) ** 2 + (y - seedY) ** 2);
      }
      
      const normalized = Math.min(dist / maxDist, 1.0);
      const inside = isInsideBuffer[idx];
      const signed = inside ? normalized : -normalized;
      const value = Math.max(0, Math.min(1, 0.5 + 0.5 * signed));
      
      const outputIdx = idx * 4;
      sdfData[outputIdx] = value;     // R
      sdfData[outputIdx + 1] = value; // G  
      sdfData[outputIdx + 2] = value; // B
      sdfData[outputIdx + 3] = 1.0;   // A
    }
  }

  const sdfTexture = new THREE.DataTexture(sdfData, width, height, THREE.RGBAFormat, THREE.FloatType);
  sdfTexture.needsUpdate = true;
  sdfTexture.minFilter = THREE.LinearFilter;
  sdfTexture.magFilter = THREE.LinearFilter;
  sdfTexture.wrapS = THREE.ClampToEdgeWrapping;
  sdfTexture.wrapT = THREE.ClampToEdgeWrapping;
  sdfTexture.flipY = true
  return sdfTexture;
}
export function generateSDFfromDataTextureSmooth2(binaryTexture, bandWidth = 8, falloffCurve = 2.0) {
  const width = binaryTexture.image.width;
  const height = binaryTexture.image.height;
  const inputData = binaryTexture.image.data;
  
  function getIndex(x, y) {
    return y * width + x;
  }
  
  function isInside(x, y) {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    const i = (y * width + x) * 4;
    return inputData[i] > 127;
  }
  
  // Use fast distance transform approach
  const dist = new Float32Array(width * height);
  const INF = bandWidth + 10;
  
  // Initialize - find surface pixels
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = getIndex(x, y);
      
      // Check if surface pixel
      let isSurface = false;
      const inside = isInside(x, y);
      
      for (let dy = -1; dy <= 1 && !isSurface; dy++) {
        for (let dx = -1; dx <= 1 && !isSurface; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            if (isInside(nx, ny) !== inside) {
              isSurface = true;
            }
          }
        }
      }
      
      dist[idx] = isSurface ? 0 : INF;
    }
  }
  
  // Distance transform with band limit
  for (let pass = 0; pass < bandWidth; pass++) {
    let changed = false;
    
    // Forward pass
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = getIndex(x, y);
        let minDist = dist[idx];
        
        // Check 4-connected neighbors
        if (x > 0) minDist = Math.min(minDist, dist[getIndex(x-1, y)] + 1);
        if (y > 0) minDist = Math.min(minDist, dist[getIndex(x, y-1)] + 1);
        
        if (minDist < dist[idx] && minDist <= bandWidth) {
          dist[idx] = minDist;
          changed = true;
        }
      }
    }
    
    // Backward pass
    for (let y = height - 1; y >= 0; y--) {
      for (let x = width - 1; x >= 0; x--) {
        const idx = getIndex(x, y);
        let minDist = dist[idx];
        
        if (x < width - 1) minDist = Math.min(minDist, dist[getIndex(x+1, y)] + 1);
        if (y < height - 1) minDist = Math.min(minDist, dist[getIndex(x, y+1)] + 1);
        
        if (minDist < dist[idx] && minDist <= bandWidth) {
          dist[idx] = minDist;
          changed = true;
        }
      }
    }
    
    if (!changed) break;
  }
  
  // Generate texture with smooth falloff
  const sdfData = new Float32Array(width * height * 4);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = getIndex(x, y);
      const d = dist[idx];
      
      let value;
      if (d > bandWidth) {
        value = 0; // Beyond band
      } else {
        // Smooth falloff curve
        const t = d / bandWidth; // 0 to 1
        value = Math.pow(1.0 - t, falloffCurve); // Smooth curve
      }
      
      const outputIdx = idx * 4;
      sdfData[outputIdx] = value;
      sdfData[outputIdx + 1] = value;
      sdfData[outputIdx + 2] = value;
      sdfData[outputIdx + 3] = 1.0;
    }
  }
  
  const sdfTexture = new THREE.DataTexture(sdfData, width, height, THREE.RGBAFormat, THREE.FloatType);
  sdfTexture.needsUpdate = true;
  sdfTexture.minFilter = THREE.LinearFilter;
  sdfTexture.magFilter = THREE.LinearFilter;
  sdfTexture.wrapS = THREE.ClampToEdgeWrapping;
  sdfTexture.wrapT = THREE.ClampToEdgeWrapping;
  
  return sdfTexture;
}
/**
 * Alternative: Simple distance transform using separable passes (even faster for some cases)
 */
export function generateSDFfromDataTextureFast(binaryTexture, maxDist = 20) {
  const width = binaryTexture.image.width;
  const height = binaryTexture.image.height;  
  const inputData = binaryTexture.image.data;
  
  const INF = width + height; // Large number
  const dist = new Float32Array(width * height);
  
  function getIndex(x, y) {
    return y * width + x;
  }
  
  function isInside(x, y) {
    const i = (y * width + x) * 4;
    return inputData[i] > 127;
  }
  
  // Initialize distances
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = getIndex(x, y);
      dist[idx] = isInside(x, y) ? 0 : INF;
    }
  }
  
  // Forward pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = getIndex(x, y);
      if (x > 0) {
        dist[idx] = Math.min(dist[idx], dist[getIndex(x-1, y)] + 1);
      }
      if (y > 0) {
        dist[idx] = Math.min(dist[idx], dist[getIndex(x, y-1)] + 1);
      }
    }
  }
  
  // Backward pass  
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const idx = getIndex(x, y);
      if (x < width - 1) {
        dist[idx] = Math.min(dist[idx], dist[getIndex(x+1, y)] + 1);
      }
      if (y < height - 1) {
        dist[idx] = Math.min(dist[idx], dist[getIndex(x, y+1)] + 1);
      }
    }
  }
  
  // Convert to SDF
  const sdfData = new Float32Array(width * height * 4);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = getIndex(x, y);
      const inside = isInside(x, y);
      const d = Math.min(dist[idx], maxDist) / maxDist;
      const signed = inside ? d : -d;
      const value = Math.max(0, Math.min(1, 0.5 + 0.5 * signed));
      
      const outputIdx = idx * 4;
      sdfData[outputIdx] = value;
      sdfData[outputIdx + 1] = value;
      sdfData[outputIdx + 2] = value; 
      sdfData[outputIdx + 3] = 1.0;
    }
  }
  
  const sdfTexture = new THREE.DataTexture(sdfData, width, height, THREE.RGBAFormat, THREE.FloatType);
  sdfTexture.needsUpdate = true;
  sdfTexture.minFilter = THREE.LinearFilter;
  sdfTexture.magFilter = THREE.LinearFilter;
  sdfTexture.wrapS = THREE.ClampToEdgeWrapping;
  sdfTexture.wrapT = THREE.ClampToEdgeWrapping;
  
  return sdfTexture;
}
export function generateInwardSDFfromWhiteSurface(binaryTexture, bandWidth = 8) {
  const width = binaryTexture.image.width;
  const height = binaryTexture.image.height;
  const inputData = binaryTexture.image.data;
  
  function getIndex(x, y) {
    return y * width + x;
  }
  
  function getInputIndex(x, y) {
    return (y * width + x) * 4;
  }
  
  function isInside(x, y) {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    const i = getInputIndex(x, y);
    return inputData[i] > 127;
  }
  
  // Find boundary pixels (surface)
  const boundaryPixels = [];
  const distanceField = new Float32Array(width * height);
  const processed = new Uint8Array(width * height);
  
  // Initialize: find all boundary pixels
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = getIndex(x, y);
      const inside = isInside(x, y);
      
      if (inside) {
        // Check if this inside pixel is near boundary
        let isBoundary = false;
        for (let dy = -1; dy <= 1 && !isBoundary; dy++) {
          for (let dx = -1; dx <= 1 && !isBoundary; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (!isInside(nx, ny)) {
              isBoundary = true;
            }
          }
        }
        
        if (isBoundary) {
          // This is a surface pixel - set to white (distance 0)
          distanceField[idx] = 0;
          boundaryPixels.push({x, y, dist: 0});
          processed[idx] = 1;
        } else {
          // Interior pixel - will be computed later
          distanceField[idx] = -1; // Mark as unprocessed interior
        }
      } else {
        // Outside pixel - set to black (no gradient)
        distanceField[idx] = bandWidth + 1; // Beyond band
        processed[idx] = 1;
      }
    }
  }
  
  // Propagate distances inward using breadth-first search
  const queue = [...boundaryPixels];
  let queueIndex = 0;
  
  const directions = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1]
  ];
  
  while (queueIndex < queue.length) {
    const current = queue[queueIndex++];
    const {x, y, dist} = current;
    
    if (dist >= bandWidth) continue; // Don't propagate beyond band
    
    for (const [dx, dy] of directions) {
      const nx = x + dx;
      const ny = y + dy;
      
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      
      const nIdx = getIndex(nx, ny);
      
      // Only process unprocessed inside pixels
      if (!processed[nIdx] && isInside(nx, ny)) {
        const stepDist = (dx === 0 || dy === 0) ? 1 : Math.SQRT2; // Diagonal vs orthogonal
        const newDist = dist + stepDist;
        
        if (newDist <= bandWidth) {
          distanceField[nIdx] = newDist;
          processed[nIdx] = 1;
          queue.push({x: nx, y: ny, dist: newDist});
        }
      }
    }
  }
  
  // Generate final texture
  const sdfData = new Float32Array(width * height * 4);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = getIndex(x, y);
      const dist = distanceField[idx];
      
      let value;
      if (dist < 0) {
        // Unprocessed interior - set to minimum value (darkest)
        value = 0;
      } else if (dist > bandWidth) {
        // Outside or beyond band - set to black
        value = 0;
      } else {
        // Within narrow band - gradient from surface (white) to interior (black)
        const normalizedDist = dist / bandWidth;
        value = 1.0 - normalizedDist; // 1.0 at surface, 0.0 at band edge
      }
      
      const outputIdx = idx * 4;
      sdfData[outputIdx] = value;     // R
      sdfData[outputIdx + 1] = value; // G
      sdfData[outputIdx + 2] = value; // B
      sdfData[outputIdx + 3] = 1.0;   // A
    }
  }
  
  const sdfTexture = new THREE.DataTexture(sdfData, width, height, THREE.RGBAFormat, THREE.FloatType);
  sdfTexture.needsUpdate = true;
  sdfTexture.minFilter = THREE.LinearFilter;
  sdfTexture.magFilter = THREE.LinearFilter;
  sdfTexture.wrapS = THREE.ClampToEdgeWrapping;
  sdfTexture.wrapT = THREE.ClampToEdgeWrapping;
  
  return sdfTexture;
}


export function generateNarrowBandSDFSmooth(binaryTexture, bandWidth = 20, falloffCurve = 1.0) {
//   const width = binaryTexture.image.width;
//   const height = binaryTexture.image.height;
//   const inputData = binaryTexture.image.data;
    const width = binaryTexture.source.data.width;
  const height = binaryTexture.source.data.height;
  const inputData = binaryTexture.source.data.data;
  function getIndex(x, y) {
    return y * width + x;
  }
  
  function isInside(x, y) {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    const i = (y * width + x) * 4;
    return inputData[i] > 127;
  }
  
  // Use fast distance transform for narrow band
  const dist = new Float32Array(width * height);
  const INF = bandWidth + 10;
  
  // Initialize
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = getIndex(x, y);
      const inside = isInside(x, y);
      
      if (!inside) {
        dist[idx] = INF; // Outside
      } else {
        // Check if boundary
        let isBoundary = false;
        for (let dy = -1; dy <= 1 && !isBoundary; dy++) {
          for (let dx = -1; dx <= 1 && !isBoundary; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (!isInside(x + dx, y + dy)) {
              isBoundary = true;
            }
          }
        }
        dist[idx] = isBoundary ? 0 : INF;
      }
    }
  }
  
  // Distance transform with narrow band limit
  for (let pass = 0; pass < bandWidth; pass++) {
    let changed = false;
    
    // Forward pass
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = getIndex(x, y);
        if (!isInside(x, y)) continue;
        
        let minDist = dist[idx];
        
        // Check 4-connected neighbors
        if (x > 0) minDist = Math.min(minDist, dist[getIndex(x-1, y)] + 1);
        if (y > 0) minDist = Math.min(minDist, dist[getIndex(x, y-1)] + 1);
        
        if (minDist < dist[idx] && minDist <= bandWidth) {
          dist[idx] = minDist;
          changed = true;
        }
      }
    }
    
    // Backward pass
    for (let y = height - 1; y >= 0; y--) {
      for (let x = width - 1; x >= 0; x--) {
        const idx = getIndex(x, y);
        if (!isInside(x, y)) continue;
        
        let minDist = dist[idx];
        
        if (x < width - 1) minDist = Math.min(minDist, dist[getIndex(x+1, y)] + 1);
        if (y < height - 1) minDist = Math.min(minDist, dist[getIndex(x, y+1)] + 1);
        
        if (minDist < dist[idx] && minDist <= bandWidth) {
          dist[idx] = minDist;
          changed = true;
        }
      }
    }
    
    if (!changed) break;
  }
  
  // Generate texture with smooth falloff
  const sdfData = new Float32Array(width * height * 4);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = getIndex(x, y);
      const d = dist[idx];
      
      let value;
      if (!isInside(x, y) || d > bandWidth) {
        value = 0; // Outside or beyond band
      } else {
        // Smooth falloff curve
        const t = d / bandWidth; // 0 to 1
        value = Math.pow(1.0 - t, falloffCurve); // Smooth curve
      }
      
      const outputIdx = idx * 4;
      sdfData[outputIdx] = value;
      sdfData[outputIdx + 1] = value;
      sdfData[outputIdx + 2] = value;
      sdfData[outputIdx + 3] = 1.0;
    }
  }
  
  const sdfTexture = new THREE.DataTexture(sdfData, width, height, THREE.RGBAFormat, THREE.FloatType);
  sdfTexture.needsUpdate = true;
  sdfTexture.minFilter = THREE.LinearFilter;
  sdfTexture.magFilter = THREE.LinearFilter;
  sdfTexture.wrapS = THREE.ClampToEdgeWrapping;
  sdfTexture.wrapT = THREE.ClampToEdgeWrapping;
  sdfTexture.flipY = true
  return sdfTexture;
}
