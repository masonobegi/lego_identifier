import axios from 'axios';

const BASE_URL = 'https://api.brickognize.com';

export async function identifyPart(imageUri) {
  const formData = new FormData();
  formData.append('query_image', {
    uri: imageUri,
    type: 'image/jpeg',
    name: 'part.jpg',
  });

  const response = await axios.post(`${BASE_URL}/predict/`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 15000,
  });

  return response.data;
}
