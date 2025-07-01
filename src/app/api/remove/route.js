/* // app/api/remove/route.ts
import { NextRequest, NextResponse } from 'next/server';
import FormData from 'form-data';
import axios from 'axios';

export async function POST(req) {
  const data = await req.formData();
  const file = data.get('image') ;

  if (!file) {
    return NextResponse.json({ error: 'No image provided' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const form = new FormData();
  form.append('image_file', buffer, {
    filename: file.name,
    contentType: file.type,
  });
  form.append('size', 'auto');

  try {
    const response = await axios.post('https://api.remove.bg/v1.0/removebg', form, {
      headers: {
        ...form.getHeaders(),
        'X-Api-Key': process.env.REMOVE_BG_API_KEY!,
      },
      responseType: 'arraybuffer',
    });

    return new NextResponse(response.data, {
      headers: {
        'Content-Type': 'image/png',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error.response?.data || error.message }, { status: 500 });
  }
}
 */