import type { DistributionOrder, FlightOffer, HotelOffer } from "../src/types.js";

export const hotels: HotelOffer[] = [
  { id:"HTL-SHA-001",name:"上海外滩华尔道夫酒店",city:"上海",district:"黄浦区 · 外滩",rating:4.9,stars:5,image:"https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=900&q=80",tags:["外滩景观","室内泳池","健身中心"],roomName:"豪华江景大床房",breakfast:"含双早",cancelPolicy:"入住前1天免费取消",nightlyPrice:1688,currency:"CNY" },
  { id:"HTL-SHA-002",name:"上海静安香格里拉",city:"上海",district:"静安区 · 南京西路",rating:4.8,stars:5,image:"https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?auto=format&fit=crop&w=900&q=80",tags:["地铁直达","行政酒廊","亲子友好"],roomName:"豪华阁城市景观房",breakfast:"含双早",cancelPolicy:"入住前2天免费取消",nightlyPrice:1320,currency:"CNY" },
  { id:"HTL-SHA-003",name:"上海前滩雅辰悦居酒店",city:"上海",district:"浦东新区 · 前滩",rating:4.7,stars:4,image:"https://images.unsplash.com/photo-1564501049412-61c2a3083791?auto=format&fit=crop&w=900&q=80",tags:["新开业","设计酒店","免费停车"],roomName:"悦居特大床房",breakfast:"不含早",cancelPolicy:"18:00前免费取消",nightlyPrice:826,currency:"CNY" },
];

export const flights: FlightOffer[] = [
  { id:"FLT-001",airline:"国泰航空",airlineCode:"CX",flightNo:"CX365",departureAirport:"PVG 浦东T2",arrivalAirport:"HKG 香港T1",departureTime:"09:40",arrivalTime:"12:30",duration:"2h50m",stops:0,cabin:"经济舱",baggage:"1件23kg",price:1680,currency:"CNY",priceKey:"pk_demo_cx365" },
  { id:"FLT-002",airline:"香港航空",airlineCode:"HX",flightNo:"HX237",departureAirport:"PVG 浦东T2",arrivalAirport:"HKG 香港T1",departureTime:"11:55",arrivalTime:"14:45",duration:"2h50m",stops:0,cabin:"经济舱",baggage:"1件20kg",price:1420,currency:"CNY",priceKey:"pk_demo_hx237" },
  { id:"FLT-003",airline:"中国东方航空",airlineCode:"MU",flightNo:"MU509",departureAirport:"SHA 虹桥T1",arrivalAirport:"HKG 香港T1",departureTime:"16:20",arrivalTime:"19:10",duration:"2h50m",stops:0,cabin:"经济舱",baggage:"1件23kg",price:1560,currency:"CNY",priceKey:"pk_demo_mu509" },
];

export const orders: DistributionOrder[] = [
  { id:"FG202607290018",supplierOrderNo:"FCG-H-882016",productType:"hotel",title:"上海外滩华尔道夫酒店",subtitle:"8月12日-14日 · 2晚",customer:"智联科技",amount:3376,currency:"CNY",status:"CONFIRMED",createdAt:"今天 09:42" },
  { id:"FG202607290017",supplierOrderNo:"FL-76282015",productType:"flight",title:"上海 → 香港",subtitle:"CX365 · 8月12日",customer:"恒生咨询",amount:3360,currency:"CNY",status:"TICKETED",createdAt:"今天 09:18" },
  { id:"FG202607290016",productType:"hotel",title:"上海静安香格里拉",subtitle:"8月18日-20日 · 2晚",customer:"星海贸易",amount:2640,currency:"CNY",status:"PROCESSING",createdAt:"今天 08:56" },
  { id:"FG202607290015",productType:"flight",title:"北京 → 新加坡",subtitle:"SQ807 · 8月6日",customer:"远景能源",amount:5280,currency:"CNY",status:"PENDING_PAYMENT",createdAt:"今天 08:31" },
  { id:"FG202607280089",supplierOrderNo:"FCG-H-881967",productType:"hotel",title:"香港瑰丽酒店",subtitle:"8月3日-5日 · 2晚",customer:"奥创数据",amount:7980,currency:"CNY",status:"REFUNDING",createdAt:"昨天 22:14" },
];
