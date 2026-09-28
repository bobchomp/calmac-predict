import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata = {
  title: "Will It Sail? – CalMac Predictor",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#003087",
};

const APP_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAALQAAAC0CAYAAAA9zQYyAAAFBElEQVR4nO3cu24cZRzG4VmLihqhQOUrQCBRICrchTuAJq5TUNFALiDQUHEFSYMrShQaTIVSIIG4glRRQDQ0aSicIj6uZ2bnfHj3eapEnvnmi+fnf8b2ajfFFN7/5myS67Bsf369GfsS41xAwDQxQuDDLihkuhgw7P4LiZgh9Yz7oNfFxczQejbV7atByEyhw7RuP6HFzFQ6tNYuaDEztZbNNQ9azMylRXvNghYzc2vY4O6gxcxSNGixPmgxszQ7mqwOWswsVU2b5UGLmaWraLTfbwphYW4HbTqzFiWtHuw6ABZtq1mPHEQRNFGugva4wVpda9eEJsrroE1n1u68YROaKIImiqCJsvH8TBITmiiCJoqgiSJoogiaKIImyhtzb4Ar7/7z/SjrPn/7i1HWXSITmiiCJoqgibKXQT89uV88Pbk/9zYYwV4GTS5BE0XQRBE0UQRNFL8pXJAfX741yrofjbLqMpnQRBE0UQRNFEETRdBEETRRBE0UQRNF0EQRNFEETZRVvlnji1+/7HX+sxcvi6IoisM7bw6xncE8O/xwlHUPn/0+6Hp3Pvlu0PWGtJcvTlpayBeGDm8feeQgiqCJImiiCJoogiaKoIkiaKIImiiCJoqgiSJoogiaKLEvTvr8t39bn/PDx9XvXLRv662VCU0UQRNF0EQRNFEETRRBE0XQRBE0UQRNFEETRdBEETRRBE0UQRNlL9+skX6W/GaNJjRRBE0UQRNF0EQRNFEETRRBE0XQRBE0UWZ/o5mzP75qfc7f//0/wk5oqu6ebT74dsKdlFx/zl99d4mZ5Zszao8cRJktaNM515z31oQmyixBm8755rrHkwct5v0xx732yEGUSYM2nffP1PfchCbKZEGbzvtryns/SdBiZqoGegd99PB4iH1AqaOHx60a6/RajroLnD54dOPvpjPXNXmdR1Vf222VaT2hd321XP+4mNm2q4m6vppM6t6PHGVfNR5D6KJJN7uOaRX09mIXMZdFbTpTpayNslBPHzxqPTAPdh3QZJGLi0MXVTGX/bnunKIois3RT88vvyk8Pfmr/IKfvXf7gjXH/vLpO6Ufg+s2xz+3bmvXsTeCLjugzQWrzik7vskxbfcxxF6HWHdNey07Z83369Yz9PUTulyw7Jjtddp+cqqOGWOvdddoek6TINqu2WRd96soNsW9J2e7PtltLnihasNd/yF165Zps2bZumPttWzdvnutsm/3qyjOg25y4bYXbLLmWOuuaa9jrbuve7185KhbtMsFm5w3xrpr2utY6+7zXi8n9LaLr4CuFyxbq8mGuqw7xFpla69t3aJwvyqDhjXyAn+iCJoogiaKoIkiaKIImiiCJoqgiSJoogiaKIImiqCJImiiCJoogiaKoIkiaKIImiiCJoqgiSJoogiaKIImiqCJImiiCJoogiaKoIkiaKIImiiCJoqgiSJoogiaKIImiqCJclA8vruZexMwiMd3NyY0UQRNFEET5XXQnqNZu/OGTWiiXAVtSrNW19o1oYkiaKLcDNpjB2uz1eztCS1q1qKkVY8cRCkP2pRm6SoarZ7Qomapatqsf+QQNUuzo8ndz9CiZikatNjsm0JRM7eGDTb/KYeomUuL9tr92E7UTK1lc+1/Di1qptKhtX5x3nty1ut8KNNjaPb7TaFpzdB6NjVskCY2XQw4GMeZsMKmiRH+h5/mkUHgFMUkj6ivAMLW5i3qFzU6AAAAAElFTkSuQmCC";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href={APP_ICON} />
        <link rel="icon" type="image/png" href={APP_ICON} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Will It Sail?" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=Source+Sans+3:wght@400;500;600&display=swap"
        />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
