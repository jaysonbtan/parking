export interface Coordinates {
  lat: number;
  lon: number;
}

export interface ParkingMeter {
  meter_id: string;
  service_status: string;
  mobile_payment_number: number;
  rate_9am_6pm: string;
  rate_6pm_10pm: string;
  sector: number;
  direction: string | null;
  geo_point_2d: { lat: number; lon: number };
}

export interface ParkingMeterWithDistance extends ParkingMeter {
  distanceMeters: number;
  sortRate: number;
}

export interface ApiRecordsResponse {
  total_count: number;
  results: ParkingMeter[];
}
