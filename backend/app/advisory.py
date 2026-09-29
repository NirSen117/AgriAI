from datetime import datetime, timezone
import re

from .schemas import AdvisoryItem, AdvisoryResponse, SoilObservation, WeatherObservation


_LOCAL_TEXT = {
    "hi": {
        "summary": "मौसम और मिट्टी के उपलब्ध संकेतों के आधार पर सलाह।",
        "Plan around rain": ("बारिश को ध्यान में रखकर योजना बनाएं", "बारिश से पहले सिंचाई टालें और छिड़काव न करें।", "बारिश की संभावना {value} है।"),
        "Check soil moisture": ("मिट्टी की नमी जाँचें", "यदि जड़ क्षेत्र सूखा हो तो सुबह थोड़ी सिंचाई करें।", "मिट्टी की नमी {value} है।"),
        "Build soil health": ("मिट्टी का स्वास्थ्य सुधारें", "जहाँ संभव हो, कम्पोस्ट या फसल अवशेष मिलाएँ।", "जैविक कार्बन {value} से कम है।"),
        "Continue monitoring": ("निगरानी जारी रखें", "इस सप्ताह फसल की जाँच करें और बदलाव दर्ज करें।", "उपलब्ध संकेत सामान्य सीमा में हैं।"),
        "Check water and shade": ("पशुओं के पानी और छाया की जाँच करें", "साफ पीने का पानी उपलब्ध रखें और छायादार जगह की जाँच करें।", "खेत की प्रोफ़ाइल में पशुधन दर्ज है।"),
    },
    "kn": {
        "summary": "ಲಭ್ಯವಿರುವ ಹವಾಮಾನ ಮತ್ತು ಮಣ್ಣಿನ ಸೂಚನೆಗಳ ಆಧಾರದ ಸಲಹೆ.",
        "Plan around rain": ("ಮಳೆಗೆ ಅನುಗುಣವಾಗಿ ಯೋಜಿಸಿ", "ಮಳೆಯ ಮೊದಲು ನೀರಾವರಿ ಮುಂದೂಡಿ ಮತ್ತು ಸಿಂಪಡಣೆ ಮಾಡಬೇಡಿ.", "ಮಳೆಯ ಸಾಧ್ಯತೆ {value} ಇದೆ."),
        "Check soil moisture": ("ಮಣ್ಣಿನ ತೇವಾಂಶ ಪರಿಶೀಲಿಸಿ", "ಬೇರಿನ ಭಾಗ ಒಣಗಿದ್ದರೆ ಬೆಳಿಗ್ಗೆ ಸ್ವಲ್ಪ ನೀರು ಹಾಯಿಸಿ.", "ಮಣ್ಣಿನ ತೇವಾಂಶ {value} ಇದೆ."),
        "Build soil health": ("ಮಣ್ಣಿನ ಆರೋಗ್ಯ ಸುಧಾರಿಸಿ", "ಸಾಧ್ಯವಾದಲ್ಲಿ ಕಾಂಪೋಸ್ಟ್ ಅಥವಾ ಬೆಳೆ ಅವಶೇಷ ಸೇರಿಸಿ.", "ಸಾವಯವ ಕಾರ್ಬನ್ {value} ಕ್ಕಿಂತ ಕಡಿಮೆ ಇದೆ."),
        "Continue monitoring": ("ಮೇಲ್ವಿಚಾರಣೆ ಮುಂದುವರಿಸಿ", "ಈ ವಾರ ಬೆಳೆ ಪರಿಶೀಲಿಸಿ ಮತ್ತು ಬದಲಾವಣೆಗಳನ್ನು ದಾಖಲಿಸಿ.", "ಲಭ್ಯವಿರುವ ಸೂಚನೆಗಳು ಸಾಮಾನ್ಯ ವ್ಯಾಪ್ತಿಯಲ್ಲಿವೆ."),
        "Check water and shade": ("ಪ್ರಾಣಿಗಳಿಗೆ ನೀರು ಮತ್ತು ನೆರಳು ಪರಿಶೀಲಿಸಿ", "ಶುದ್ಧ ಕುಡಿಯುವ ನೀರು ಮತ್ತು ನೆರಳಿನ ಸ್ಥಳ ಒದಗಿಸಿ.", "ಕೃಷಿ ಪ್ರೊಫೈಲ್‌ನಲ್ಲಿ ಜಾನುವಾರುಗಳಿವೆ."),
    },
    "ta": {
        "summary": "கிடைக்கும் வானிலை மற்றும் மண் அறிகுறிகளை அடிப்படையாகக் கொண்ட ஆலோசனை.",
        "Plan around rain": ("மழைக்கு ஏற்ப திட்டமிடுங்கள்", "மழைக்கு முன் நீர்ப்பாசனத்தைத் தள்ளி வைத்து தெளிப்பதைத் தவிர்க்கவும்.", "மழை வாய்ப்பு {value}."),
        "Check soil moisture": ("மண் ஈரப்பதத்தைச் சரிபார்க்கவும்", "வேர் பகுதி உலர்ந்திருந்தால் காலையில் சிறிதளவு நீர் பாய்ச்சவும்.", "மண் ஈரப்பதம் {value}."),
        "Build soil health": ("மண் வளத்தை மேம்படுத்துங்கள்", "முடிந்தால் உரக்கம்போஸ்ட் அல்லது பயிர் எச்சங்களைச் சேர்க்கவும்.", "கரிம கார்பன் {value}-க்கும் குறைவு."),
        "Continue monitoring": ("கண்காணிப்பைத் தொடருங்கள்", "இந்த வாரம் பயிரைச் சரிபார்த்து மாற்றங்களைப் பதிவு செய்யுங்கள்.", "கிடைக்கும் அறிகுறிகள் வழக்கமான வரம்பில் உள்ளன."),
        "Check water and shade": ("விலங்குகளுக்கு நீரும் நிழலும் உள்ளதா பாருங்கள்", "சுத்தமான குடிநீர் மற்றும் நிழலான இடம் இருப்பதை உறுதிப்படுத்துங்கள்.", "பண்ணை விவரத்தில் கால்நடைகள் உள்ளன."),
    },
    "te": {
        "summary": "అందుబాటులో ఉన్న వాతావరణం, నేల సూచనల ఆధారంగా సలహా.",
        "Plan around rain": ("వర్షానికి అనుగుణంగా ప్లాన్ చేయండి", "వర్షానికి ముందు నీరు పెట్టడం వాయిదా వేసి పిచికారీ చేయవద్దు.", "వర్ష సూచన {value}."),
        "Check soil moisture": ("నేల తేమను తనిఖీ చేయండి", "వేరు ప్రాంతం పొడిగా ఉంటే ఉదయం కొద్దిగా నీరు పెట్టండి.", "నేల తేమ {value}."),
        "Build soil health": ("నేల ఆరోగ్యాన్ని మెరుగుపరచండి", "వీలైతే కంపోస్ట్ లేదా పంట అవశేషాలను కలపండి.", "సేంద్రీయ కార్బన్ {value} కంటే తక్కువగా ఉంది."),
        "Continue monitoring": ("పర్యవేక్షణ కొనసాగించండి", "ఈ వారం పంటను చూసి మార్పులను నమోదు చేయండి.", "అందుబాటులో ఉన్న సూచనలు సాధారణ పరిధిలో ఉన్నాయి."),
        "Check water and shade": ("జంతువులకు నీరు, నీడ ఉన్నాయో చూడండి", "శుభ్రమైన తాగునీరు, నీడగల స్థలం అందుబాటులో ఉంచండి.", "వ్యవసాయ ప్రొఫైల్‌లో పశువులు ఉన్నాయి."),
    },
    "bn": {
        "summary": "উপলব্ধ আবহাওয়া ও মাটির তথ্যের ভিত্তিতে পরামর্শ।",
        "Plan around rain": ("বৃষ্টির কথা মাথায় রেখে পরিকল্পনা করুন", "বৃষ্টির আগে সেচ পিছিয়ে দিন এবং স্প্রে এড়িয়ে চলুন।", "বৃষ্টির সম্ভাবনা {value}।"),
        "Check soil moisture": ("মাটির আর্দ্রতা পরীক্ষা করুন", "শিকড়ের মাটি শুকনো থাকলে সকালে অল্প জল দিন।", "মাটির আর্দ্রতা {value}।"),
        "Build soil health": ("মাটির স্বাস্থ্য উন্নত করুন", "সম্ভব হলে কম্পোস্ট বা ফসলের অবশিষ্টাংশ যোগ করুন।", "জৈব কার্বন {value}-এর নিচে।"),
        "Continue monitoring": ("পর্যবেক্ষণ চালিয়ে যান", "এই সপ্তাহে ফসল দেখে পরিবর্তন লিখে রাখুন।", "উপলব্ধ সূচক স্বাভাবিক সীমায় রয়েছে।"),
        "Check water and shade": ("পশুর পানি ও ছায়া পরীক্ষা করুন", "পরিষ্কার পানীয় জল ও ছায়ার জায়গা রাখুন।", "খামারের তথ্যে পশুপালন রয়েছে।"),
    },
    "mr": {
        "summary": "उपलब्ध हवामान आणि मातीच्या संकेतांवर आधारित सल्ला.",
        "Plan around rain": ("पावसाचा अंदाज लक्षात घेऊन नियोजन करा", "पावसापूर्वी सिंचन पुढे ढकला आणि फवारणी टाळा.", "पावसाची शक्यता {value} आहे."),
        "Check soil moisture": ("मातीतील ओलावा तपासा", "मुळांचा भाग कोरडा असल्यास सकाळी थोडे पाणी द्या.", "मातीतील ओलावा {value} आहे."),
        "Build soil health": ("मातीचे आरोग्य सुधारा", "शक्य असल्यास कंपोस्ट किंवा पीक अवशेष मिसळा.", "सेंद्रिय कार्बन {value} पेक्षा कमी आहे."),
        "Continue monitoring": ("निरीक्षण सुरू ठेवा", "या आठवड्यात पीक तपासा आणि बदल नोंदवा.", "उपलब्ध संकेत सामान्य मर्यादेत आहेत."),
        "Check water and shade": ("जनावरांसाठी पाणी आणि सावली तपासा", "स्वच्छ पिण्याचे पाणी आणि सावलीची जागा ठेवा.", "शेतीच्या माहितीत पशुधन नोंदले आहे."),
    },
}


def localize_advisory(advisory: AdvisoryResponse, language: str | None) -> AdvisoryResponse:
    translations = _LOCAL_TEXT.get(language or "")
    if not translations:
        return advisory
    localized: list[AdvisoryItem] = []
    for item in advisory.items:
        strings = translations.get(item.title)
        if not strings:
            localized.append(item)
            continue
        value_match = re.search(r"(?:probability is |moisture is |below )([0-9.]+%?)", item.reason, re.IGNORECASE)
        value = value_match.group(1) if value_match else ""
        localized.append(item.model_copy(update={
            "title": strings[0], "action": strings[1], "reason": strings[2].format(value=value)
        }))
    return advisory.model_copy(update={"summary": translations["summary"], "items": localized, "source": "rules+local-copy"})


def build_advisory(weather: WeatherObservation, soil: SoilObservation) -> AdvisoryResponse:
    items: list[AdvisoryItem] = []
    if weather.rainfall_probability >= 0.6:
        items.append(AdvisoryItem(priority="medium", title="Plan around rain", action="Delay irrigation and avoid spraying before the expected rain.",
                                   reason=f"Rain probability is {weather.rainfall_probability:.0%}."))
    if soil.moisture_percent is not None and soil.moisture_percent < 35:
        items.append(AdvisoryItem(priority="high", title="Check soil moisture", action="Irrigate in a short, early-morning cycle if the root zone is dry.",
                                   reason=f"Soil moisture is {soil.moisture_percent:.0f}%."))
    if soil.organic_carbon_percent is not None and soil.organic_carbon_percent < 1:
        items.append(AdvisoryItem(priority="low", title="Build soil health", action="Add compost or retained crop residue where practical.",
                                   reason="Organic carbon is below 1%."))
    if not items:
        items.append(AdvisoryItem(priority="low", title="Continue monitoring", action="Scout the crop twice this week and record changes.",
                                   reason="No threshold-based action was triggered by the available indicators."))
    return AdvisoryResponse(generated_at=datetime.now(timezone.utc),
                            summary="Prioritized actions based on current field indicators.", items=items)
