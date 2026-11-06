export type RepresentativeImage = {
  key: 'kumbh' | 'volunteers' | 'temple' | 'ramappa';
  src: string;
  filePage: string;
  author: string;
  license: string;
  licenseUrl: string;
  alt: string;
  title: string;
  context: string;
};

export const representativeImages: Record<RepresentativeImage['key'], RepresentativeImage> = {
  kumbh: {
    key: 'kumbh',
    src: '/images/kumbh-seva-illustrative.jpg',
    filePage: 'https://commons.wikimedia.org/wiki/File:2019_Jan_18_-_Prayagraj_Kumbh_Mela_-_Kumbh_Seva_Mitra_at_Sangam.jpg',
    author: 'Balone21', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    alt: '2019 प्रयागराज कुंभ में सेवा के लिए चुने गए स्वयंसेवक', title: 'समुदाय के साथ सहभागिता', context: 'यह प्रयागराज कुंभ 2019 की प्रतिनिधि तस्वीर है; समिति की गतिविधि नहीं।',
  },
  volunteers: {
    key: 'volunteers',
    src: '/images/community-service-illustrative.jpg',
    filePage: 'https://commons.wikimedia.org/wiki/File:Volunteers_in_Rishikesh,_India.JPG',
    author: 'Volunteers4india', license: 'CC BY-SA 3.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    alt: 'ऋषिकेश में स्वयंसेवकों का समूह', title: 'स्वयंसेवा', context: 'प्रतिनिधि दृश्य · ऋषिकेश में स्वयंसेवक; समिति का आधिकारिक कार्यक्रम नहीं।',
  },
  temple: {
    key: 'temple',
    src: '/images/brihadisvara-temple.jpg',
    filePage: 'https://commons.wikimedia.org/wiki/File:Brihadisvara_Temple_back_view_2024.jpg',
    author: 'Rathipriya Mohankumar', license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    alt: 'तंजावुर स्थित बृहदीश्वर मंदिर की स्थापत्य धरोहर', title: 'भारतीय स्थापत्य धरोहर', context: 'सांस्कृतिक विरासत का प्रतिनिधि दृश्य · बृहदीश्वर मंदिर, तंजावुर।',
  },
  ramappa: {
    key: 'ramappa',
    src: '/images/ramappa-temple.jpg',
    filePage: 'https://commons.wikimedia.org/wiki/File:13th_century_Ramappa_temple,_Rudresvara,_Palampet_Telangana_India_-_110.jpg',
    author: 'Ms Sarah Welch', license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    alt: 'तेलंगाना के पालमपेट स्थित रामप्पा मंदिर का दृश्य', title: 'मंदिर स्थापत्य', context: 'सांस्कृतिक विरासत का प्रतिनिधि दृश्य · रामप्पा मंदिर, तेलंगाना।',
  },
};
