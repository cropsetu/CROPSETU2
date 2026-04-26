/**
 * indiaLocations.js — Single source of truth for Indian states & districts
 *
 * Source: Ministry of Home Affairs official district list (2024).
 * Covers all 28 states + 8 Union Territories.
 *
 * Exports:
 *   INDIA_STATES_LIST   — sorted string array of all state/UT names
 *   INDIA_DISTRICTS     — { [stateName]: string[] } map of districts
 *   getDistricts(state) — helper: returns district array or []
 *   STATE_GPS_MAP       — maps OS reverse-geocode region strings → our state names
 */

// ─────────────────────────────────────────────────────────────────────────────
// ALL DISTRICTS BY STATE (alphabetical states, alphabetical districts within)
// ─────────────────────────────────────────────────────────────────────────────

export const INDIA_DISTRICTS = {
  'Andhra Pradesh': [
    'Alluri Sitharama Raju','Anakapalli','Ananthapuramu','Annamayya','Bapatla',
    'Chittoor','Dr. B.R. Ambedkar Konaseema','East Godavari','Eluru','Guntur',
    'Kakinada','Krishna','Kurnool','Nandyal','Nellore','NTR','Palnadu',
    'Parvathipuram Manyam','Prakasam','Sri Sathya Sai','Srikakulam','Tirupati',
    'Visakhapatnam','Vizianagaram','West Godavari','YSR Kadapa',
  ],
  'Arunachal Pradesh': [
    'Anjaw','Bichom','Changlang','East Kameng','East Siang','Kamle','Keyi Panyor',
    'Kra Daadi','Kurung Kumey','Lepa Rada','Lohit','Longding','Lower Dibang Valley',
    'Lower Siang','Lower Subansiri','Namsai','Pakke-Kessang','Papum Pare','Shi Yomi',
    'Siang','Tawang','Tirap','Upper Dibang Valley','Upper Siang','Upper Subansiri',
    'West Kameng','West Siang',
  ],
  'Assam': [
    'Bajali','Baksa','Barpeta','Biswanath','Bongaigaon','Cachar','Charaideo',
    'Chirang','Darrang','Dhemaji','Dhubri','Dibrugarh','Dima Hasao','Goalpara',
    'Golaghat','Hailakandi','Hojai','Jorhat','Kamrup','Kamrup Metropolitan',
    'Karbi Anglong','Karimganj','Kokrajhar','Lakhimpur','Majuli','Morigaon',
    'Nagaon','Nalbari','Sivasagar','Sonitpur','South Salmara-Mankachar',
    'Tamulpur','Tinsukia','Udalguri','West Karbi Anglong',
  ],
  'Bihar': [
    'Araria','Arwal','Aurangabad','Banka','Begusarai','Bhagalpur','Bhojpur',
    'Buxar','Darbhanga','East Champaran','Gaya','Gopalganj','Jamui','Jehanabad',
    'Kaimur','Katihar','Khagaria','Kishanganj','Lakhisarai','Madhepura',
    'Madhubani','Munger','Muzaffarpur','Nalanda','Nawada','Patna','Purnia',
    'Rohtas','Saharsa','Samastipur','Saran','Sheikhpura','Sheohar','Sitamarhi',
    'Siwan','Supaul','Vaishali','West Champaran',
  ],
  'Chhattisgarh': [
    'Balod','Baloda Bazar','Balrampur-Ramanujganj','Bastar','Bemetara','Bijapur',
    'Bilaspur','Dantewada','Dhamtari','Durg','Gariaband','Gaurela-Pendra-Marwahi',
    'Janjgir-Champa','Jashpur','Kabirdham','Kanker',
    'Khairagarh-Chhuikhadan-Gandai','Kondagaon','Korba','Korea','Mahasamund',
    'Manendragarh-Chirmiri-Bharatpur','Mohla-Manpur-Ambagarh Chowki','Mungeli',
    'Narayanpur','Raigarh','Raipur','Rajnandgaon','Sakti','Sarangarh-Bilaigarh',
    'Sukma','Surajpur','Surguja',
  ],
  'Goa': ['North Goa','South Goa'],
  'Gujarat': [
    'Ahmedabad','Amreli','Anand','Aravalli','Banaskantha','Bharuch','Bhavnagar',
    'Botad','Chhota Udaipur','Dahod','Dang','Devbhoomi Dwarka','Gandhinagar',
    'Gir Somnath','Jamnagar','Junagadh','Kheda','Kutch','Mahisagar','Mehsana',
    'Morbi','Narmada','Navsari','Panchmahal','Patan','Porbandar','Rajkot',
    'Sabarkantha','Surat','Surendranagar','Tapi','Vadodara','Valsad',
  ],
  'Haryana': [
    'Ambala','Bhiwani','Charkhi Dadri','Faridabad','Fatehabad','Gurugram','Hisar',
    'Jhajjar','Jind','Kaithal','Karnal','Kurukshetra','Mahendragarh','Nuh',
    'Palwal','Panchkula','Panipat','Rewari','Rohtak','Sirsa','Sonipat',
    'Yamunanagar',
  ],
  'Himachal Pradesh': [
    'Bilaspur','Chamba','Hamirpur','Kangra','Kinnaur','Kullu','Lahaul and Spiti',
    'Mandi','Shimla','Sirmaur','Solan','Una',
  ],
  'Jharkhand': [
    'Bokaro','Chatra','Deoghar','Dhanbad','Dumka','East Singhbhum','Garhwa',
    'Giridih','Godda','Gumla','Hazaribagh','Jamtara','Khunti','Koderma',
    'Latehar','Lohardaga','Pakur','Palamu','Ramgarh','Ranchi','Sahebganj',
    'Seraikela-Kharsawan','Simdega','West Singhbhum',
  ],
  'Karnataka': [
    'Bagalkot','Ballari','Belagavi','Bengaluru Rural','Bengaluru Urban','Bidar',
    'Chamarajanagar','Chikkaballapur','Chikkamagaluru','Chitradurga',
    'Dakshina Kannada','Davanagere','Dharwad','Gadag','Hassan','Haveri',
    'Kalaburagi','Kodagu','Kolar','Koppal','Mandya','Mysuru','Raichur',
    'Ramanagara','Shivamogga','Tumakuru','Udupi','Uttara Kannada','Vijayanagara',
    'Vijayapura','Yadgir',
  ],
  'Kerala': [
    'Alappuzha','Ernakulam','Idukki','Kannur','Kasaragod','Kollam','Kottayam',
    'Kozhikode','Malappuram','Palakkad','Pathanamthitta','Thiruvananthapuram',
    'Thrissur','Wayanad',
  ],
  'Madhya Pradesh': [
    'Agar Malwa','Alirajpur','Anuppur','Ashoknagar','Balaghat','Barwani','Betul',
    'Bhind','Bhopal','Burhanpur','Chhatarpur','Chhindwara','Damoh','Datia',
    'Dewas','Dhar','Dindori','Guna','Gwalior','Harda','Hoshangabad','Indore',
    'Jabalpur','Jhabua','Katni','Khandwa','Khargone','Maihar','Mandla',
    'Mandsaur','Mauganj','Morena','Nagda','Narsinghpur','Neemuch','Niwari',
    'Pandhurna','Panna','Raisen','Rajgarh','Ratlam','Rewa','Sagar','Satna',
    'Sehore','Seoni','Shahdol','Shajapur','Sheopur','Shivpuri','Sidhi',
    'Singrauli','Tikamgarh','Ujjain','Umaria','Vidisha','Vijaypur',
  ],
  'Maharashtra': [
    'Ahmednagar','Akola','Amravati','Aurangabad','Beed','Bhandara','Buldhana',
    'Chandrapur','Dharashiv','Dhule','Gadchiroli','Gondia','Hingoli','Jalgaon',
    'Jalna','Kolhapur','Latur','Mumbai City','Mumbai Suburban','Nagpur','Nanded',
    'Nandurbar','Nashik','Palghar','Parbhani','Pune','Raigad','Ratnagiri',
    'Sangli','Satara','Sindhudurg','Solapur','Thane','Wardha','Washim',
    'Yavatmal',
  ],
  'Manipur': [
    'Bishnupur','Chandel','Churachandpur','Imphal East','Imphal West','Jiribam',
    'Kakching','Kamjong','Kangpokpi','Noney','Pherzawl','Senapati','Tamenglong',
    'Tengnoupal','Thoubal','Ukhrul',
  ],
  'Meghalaya': [
    'East Garo Hills','East Jaintia Hills','East Khasi Hills',
    'Eastern West Khasi Hills','North Garo Hills','Ri-Bhoi','South Garo Hills',
    'South West Garo Hills','South West Khasi Hills','West Garo Hills',
    'West Jaintia Hills','West Khasi Hills',
  ],
  'Mizoram': [
    'Aizawl','Champhai','Hnahthial','Khawzawl','Kolasib','Lawngtlai','Lunglei',
    'Mamit','Saiha','Saitual','Serchhip',
  ],
  'Nagaland': [
    'Chumoukedima','Dimapur','Kiphire','Kohima','Longleng','Meluri','Mokokchung',
    'Mon','Niuland','Noklak','Peren','Phek','Shamator','Tuensang','Wokha',
    'Zunheboto',
  ],
  'Odisha': [
    'Angul','Balangir','Balasore','Bargarh','Bhadrak','Boudh','Cuttack',
    'Deogarh','Dhenkanal','Gajapati','Ganjam','Jagatsinghpur','Jajpur',
    'Jharsuguda','Kalahandi','Kandhamal','Kendrapara','Kendujhar','Khordha',
    'Koraput','Malkangiri','Mayurbhanj','Nabarangpur','Nayagarh','Nuapada',
    'Puri','Rayagada','Sambalpur','Subarnapur','Sundargarh',
  ],
  'Punjab': [
    'Amritsar','Barnala','Bathinda','Faridkot','Fatehgarh Sahib','Fazilka',
    'Ferozepur','Gurdaspur','Hoshiarpur','Jalandhar','Kapurthala','Ludhiana',
    'Malerkotla','Mansa','Moga','Mohali','Muktsar','Nawanshahr','Pathankot',
    'Patiala','Rupnagar','Sangrur','Tarn Taran',
  ],
  'Rajasthan': [
    'Ajmer','Alwar','Anupgarh','Balotra','Banswara','Baran','Barmer','Beawar',
    'Bharatpur','Bhilwara','Bikaner','Bundi','Chittorgarh','Churu','Dausa',
    'Deeg','Dholpur','Didwana-Kuchaman','Dudu','Dungarpur','Gangapur City',
    'Hanumangarh','Jaipur','Jaipur Rural','Jaisalmer','Jalore','Jhalawar',
    'Jhunjhunu','Jodhpur','Jodhpur Rural','Karauli','Kekri','Khairthal-Tijara',
    'Kota','Kotputli-Behror','Nagaur','Neem Ka Thana','Pali','Pratapgarh',
    'Rajsamand','Salumbar','Sanchore','Sawai Madhopur','Shahpura','Sikar',
    'Sirohi','Sri Ganganagar','Tonk','Udaipur',
  ],
  'Sikkim': ['Gangtok','Gyalshing','Mangan','Namchi','Pakyong','Soreng'],
  'Tamil Nadu': [
    'Ariyalur','Chengalpattu','Chennai','Coimbatore','Cuddalore','Dharmapuri',
    'Dindigul','Erode','Kallakurichi','Kancheepuram','Kanyakumari','Karur',
    'Krishnagiri','Madurai','Mayiladuthurai','Nagapattinam','Namakkal','Nilgiris',
    'Perambalur','Pudukkottai','Ramanathapuram','Ranipet','Salem','Sivaganga',
    'Tenkasi','Thanjavur','Theni','Thoothukudi','Tiruchirappalli','Tirunelveli',
    'Tirupattur','Tiruvallur','Tiruvannamalai','Tiruvarur','Vellore','Viluppuram',
    'Virudhunagar',
  ],
  'Telangana': [
    'Adilabad','Bhadradri Kothagudem','Hanumakonda','Hyderabad','Jagtial',
    'Jangaon','Jayashankar Bhupalapally','Jogulamba Gadwal','Kamareddy',
    'Karimnagar','Khammam','Kumuram Bheem Asifabad','Mahabubabad','Mahabubnagar',
    'Mancherial','Medak','Medchal-Malkajgiri','Mulugu','Nagarkurnool','Nalgonda',
    'Narayanpet','Nirmal','Nizamabad','Peddapalli','Rajanna Sircilla',
    'Ranga Reddy','Sangareddy','Siddipet','Suryapet','Vikarabad','Wanaparthy',
    'Warangal','Yadadri Bhuvanagiri',
  ],
  'Tripura': [
    'Dhalai','Gomati','Khowai','North Tripura','Sepahijala','South Tripura',
    'Unakoti','West Tripura',
  ],
  'Uttar Pradesh': [
    'Agra','Aligarh','Ambedkar Nagar','Amethi','Amroha','Auraiya','Ayodhya',
    'Azamgarh','Baghpat','Bahraich','Ballia','Balrampur','Banda','Barabanki',
    'Bareilly','Basti','Bhadohi','Bijnor','Budaun','Bulandshahr','Chandauli',
    'Chitrakoot','Deoria','Etah','Etawah','Farrukhabad','Fatehpur','Firozabad',
    'Gautam Buddha Nagar','Ghaziabad','Ghazipur','Gonda','Gorakhpur','Hamirpur',
    'Hapur','Hardoi','Hathras','Jalaun','Jaunpur','Jhansi','Kannauj',
    'Kanpur Dehat','Kanpur Nagar','Kasganj','Kaushambi','Kushinagar',
    'Lakhimpur Kheri','Lalitpur','Lucknow','Maharajganj','Mahoba','Mainpuri',
    'Mathura','Mau','Meerut','Mirzapur','Moradabad','Muzaffarnagar','Pilibhit',
    'Pratapgarh','Prayagraj','Raebareli','Rampur','Saharanpur','Sambhal',
    'Sant Kabir Nagar','Shahjahanpur','Shamli','Shrawasti','Siddharthnagar',
    'Sitapur','Sonbhadra','Sultanpur','Unnao','Varanasi',
  ],
  'Uttarakhand': [
    'Almora','Bageshwar','Chamoli','Champawat','Dehradun','Haridwar','Nainital',
    'Pauri Garhwal','Pithoragarh','Rudraprayag','Tehri Garhwal',
    'Udham Singh Nagar','Uttarkashi',
  ],
  'West Bengal': [
    'Alipurduar','Bankura','Birbhum','Cooch Behar','Dakshin Dinajpur','Darjeeling',
    'Hooghly','Howrah','Jalpaiguri','Jhargram','Kalimpong','Kolkata','Malda',
    'Murshidabad','Nadia','North 24 Parganas','Paschim Bardhaman',
    'Paschim Medinipur','Purba Bardhaman','Purba Medinipur','Purulia',
    'South 24 Parganas','Uttar Dinajpur',
  ],
  // ── Union Territories ─────────────────────────────────────────────────────
  'Andaman and Nicobar Islands': [
    'Nicobar','North and Middle Andaman','South Andaman',
  ],
  'Chandigarh': ['Chandigarh'],
  'Dadra and Nagar Haveli and Daman and Diu': [
    'Dadra and Nagar Haveli','Daman','Diu',
  ],
  'Delhi': [
    'Central Delhi','East Delhi','New Delhi','North Delhi','North East Delhi',
    'North West Delhi','Shahdara','South Delhi','South East Delhi',
    'South West Delhi','West Delhi',
  ],
  'Jammu and Kashmir': [
    'Anantnag','Bandipora','Baramulla','Budgam','Doda','Ganderbal','Jammu',
    'Kathua','Kishtwar','Kulgam','Kupwara','Poonch','Pulwama','Rajouri',
    'Ramban','Reasi','Samba','Shopian','Srinagar','Udhampur',
  ],
  'Ladakh': ['Kargil','Leh'],
  'Lakshadweep': ['Lakshadweep'],
  'Puducherry': ['Karaikal','Mahe','Puducherry','Yanam'],
};

// ─────────────────────────────────────────────────────────────────────────────
// SORTED STATE LIST
// ─────────────────────────────────────────────────────────────────────────────

export const INDIA_STATES_LIST = Object.keys(INDIA_DISTRICTS).sort();

// ─────────────────────────────────────────────────────────────────────────────
// MAJOR AGRICULTURAL STATES (shown first / used for mandi predictions)
// ─────────────────────────────────────────────────────────────────────────────

export const AGRI_STATES = [
  'Maharashtra','Punjab','Madhya Pradesh','Uttar Pradesh','Karnataka',
  'Andhra Pradesh','Rajasthan','Gujarat','Telangana','Tamil Nadu',
  'Bihar','West Bengal','Haryana','Odisha','Chhattisgarh','Assam',
  'Jharkhand','Kerala','Uttarakhand','Himachal Pradesh',
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the district list for a state, or [] if not found.
 * @param {string} state
 * @returns {string[]}
 */
export function getDistricts(state) {
  return INDIA_DISTRICTS[state] || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// GPS REVERSE-GEOCODE MAP
// Maps OS-reported region strings → our canonical state names.
// expo-location reverseGeocodeAsync returns `region` field as the state name;
// the exact string varies between Android and iOS.
// ─────────────────────────────────────────────────────────────────────────────

export const STATE_GPS_MAP = {
  // Standard names
  'Andhra Pradesh':         'Andhra Pradesh',
  'Arunachal Pradesh':      'Arunachal Pradesh',
  'Assam':                  'Assam',
  'Bihar':                  'Bihar',
  'Chhattisgarh':           'Chhattisgarh',
  'Chattisgarh':            'Chhattisgarh',
  'Goa':                    'Goa',
  'Gujarat':                'Gujarat',
  'Haryana':                'Haryana',
  'Himachal Pradesh':       'Himachal Pradesh',
  'Jharkhand':              'Jharkhand',
  'Karnataka':              'Karnataka',
  'Kerala':                 'Kerala',
  'Madhya Pradesh':         'Madhya Pradesh',
  'Maharashtra':            'Maharashtra',
  'Manipur':                'Manipur',
  'Meghalaya':              'Meghalaya',
  'Mizoram':                'Mizoram',
  'Nagaland':               'Nagaland',
  'Odisha':                 'Odisha',
  'Orissa':                 'Odisha',
  'Punjab':                 'Punjab',
  'Rajasthan':              'Rajasthan',
  'Sikkim':                 'Sikkim',
  'Tamil Nadu':             'Tamil Nadu',
  'Telangana':              'Telangana',
  'Tripura':                'Tripura',
  'Uttar Pradesh':          'Uttar Pradesh',
  'Uttarakhand':            'Uttarakhand',
  'Uttaranchal':            'Uttarakhand',
  'West Bengal':            'West Bengal',
  // Union Territories
  'Delhi':                              'Delhi',
  'National Capital Territory of Delhi':'Delhi',
  'NCT of Delhi':                       'Delhi',
  'Jammu and Kashmir':                  'Jammu and Kashmir',
  'Jammu & Kashmir':                    'Jammu and Kashmir',
  'Ladakh':                             'Ladakh',
  'Chandigarh':                         'Chandigarh',
  'Puducherry':                         'Puducherry',
  'Pondicherry':                        'Puducherry',
  'Andaman and Nicobar Islands':        'Andaman and Nicobar Islands',
  'Andaman & Nicobar Islands':          'Andaman and Nicobar Islands',
  'Lakshadweep':                        'Lakshadweep',
  'Dadra and Nagar Haveli and Daman and Diu': 'Dadra and Nagar Haveli and Daman and Diu',
};
