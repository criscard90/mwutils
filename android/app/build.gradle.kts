import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.criscard.mwutils"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.criscard.mwutils"
        minSdk = 26
        targetSdk = 35
        versionCode = 17
        versionName = "1.6.8"
    }

    signingConfigs {
        // Il keystore di release viene fornito dal CI tramite android/keystore.properties.
        // In locale lo puoi creare tu con la stessa struttura (storeFile, storePassword, keyAlias, keyPassword).
        val ksPropsFile = rootProject.file("keystore.properties")
        if (ksPropsFile.exists()) {
            val props = Properties()
            ksPropsFile.inputStream().use { props.load(it) }
            create("release") {
                storeFile = rootProject.file(props.getProperty("storeFile"))
                storePassword = props.getProperty("storePassword")
                keyAlias = props.getProperty("keyAlias")
                keyPassword = props.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (rootProject.file("keystore.properties").exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
}
